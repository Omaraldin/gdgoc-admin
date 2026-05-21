
# generate_cert_migration.ps1
# Converts legacy certificates table data into the new issuance_batches / issuance_recipients schema.

$srcFile = "C:\Users\iamom\AppData\Local\Packages\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\LocalState\sessions\23DB679116B137F2BAB6B3BF60E3F86DA377BE16\transfers\2026-20\data.sql"
$outFile  = Join-Path $PSScriptRoot "import_certificates.sql"

$content = [System.IO.File]::ReadAllText($srcFile, [System.Text.Encoding]::UTF8)

# -------------------------------------------------------------------------
# Parse certificate rows from the VALUES block.
# We read every line that starts with a tab+paren and has 12 commas (12 fields).
# -------------------------------------------------------------------------
function Unquote([string]$s) {
    if ($s -eq 'NULL') { return $null }
    $s = $s.Trim()
    if ($s.StartsWith("'") -and $s.EndsWith("'")) {
        $s = $s.Substring(1, $s.Length - 2)
    }
    return $s.Replace("''", "'")
}

function PgEscape([string]$s) {
    if ($null -eq $s) { return 'NULL' }
    return "'" + $s.Replace("'", "''") + "'"
}

# Approach: split content into lines, find the certificates INSERT block,
# then reconstruct full rows by joining continuation lines.
$lines = $content -split "`n"

# Locate the start/end of the certificates values section
$inCertBlock = $false
$rawRows = [System.Collections.Generic.List[string]]::new()
$currentRow = [System.Text.StringBuilder]::new()

foreach ($line in $lines) {
    $trimmed = $line.Trim()

    if ($trimmed -match '^INSERT INTO "public"\."certificates"') {
        $inCertBlock = $true
        continue
    }

    if (-not $inCertBlock) { continue }

    # End of block: a line starting with something other than ( or a continuation
    if ($trimmed -eq '' -or $trimmed -match '^--' -or $trimmed -match '^INSERT' -or $trimmed -match '^\\') {
        $inCertBlock = $false
        continue
    }

    # Accumulate row data
    $currentRow.Append($trimmed) | Out-Null

    # A row ends when we see ),  or );
    if ($trimmed -match '\)\s*[,;]\s*$') {
        $rowStr = $currentRow.ToString().TrimEnd(',', ';', ' ')
        $rawRows.Add($rowStr)
        $currentRow.Clear() | Out-Null
    }
}

Write-Host "Raw row strings collected: $($rawRows.Count)"

# Parse each raw row string
# Format: (id, 'created_at', 'name', 'email', 'role', leader_name|NULL, leader_code|NULL, chapter_name|NULL, chapter_code|NULL, season|NULL, serial|NULL, template|NULL)
$rowRe = [System.Text.RegularExpressions.Regex]::new(
    '^\(\s*\d+\s*,\s*' +
    "('(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +   # created_at [1]
    "('(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +   # full_name  [2]
    "('(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +   # email      [3]
    "('(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +   # role       [4]
    "(NULL|'(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +  # leader_name [5]
    "(NULL|'(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +  # leader_code [6]
    "(NULL|'(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +  # chapter_name[7]
    "(NULL|'(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +  # chapter_code[8]
    "(NULL|'(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +  # season      [9]
    "(NULL|'(?:[^']*(?:''[^']*)*)')" + '\s*,\s*' +  # serial      [10]
    "(NULL|'(?:[^']*(?:''[^']*)*)')" + '\s*' +      # template    [11]
    '\)\s*$',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
)

$certs = [System.Collections.Generic.List[PSCustomObject]]::new()
$skipped = 0
foreach ($row in $rawRows) {
    $m = $rowRe.Match($row)
    if (-not $m.Success) { $skipped++; continue }
    $g = $m.Groups

    $serial   = Unquote $g[10].Value
    $tmpl     = Unquote $g[11].Value
    $chapCode = Unquote $g[8].Value

    if ($null -eq $serial -or $null -eq $tmpl -or $null -eq $chapCode) { $skipped++; continue }

    # Normalize template name: dots -> dashes (gdgoc.25.green -> gdgoc-25.green)
    $tmplNorm = $tmpl -replace 'gdgoc\.25\.', 'gdgoc-25.'

    $certs.Add([PSCustomObject]@{
        CreatedAt   = (Unquote $g[1].Value)
        FullName    = (Unquote $g[2].Value)
        Email       = (Unquote $g[3].Value)
        Role        = (Unquote $g[4].Value)
        LeaderName  = (Unquote $g[5].Value)
        LeaderCode  = (Unquote $g[6].Value)
        ChapterName = (Unquote $g[7].Value)
        ChapterCode = $chapCode.ToUpper()
        GdgSeason   = (Unquote $g[9].Value)
        Serial      = $serial
        Template    = $tmplNorm
        BatchId     = ''
    }) | Out-Null
}

Write-Host "Parsed  : $($certs.Count) valid certificate records"
Write-Host "Skipped : $skipped rows (NULL serial/template/chapter)"

$templateSlugs = $certs | Select-Object -ExpandProperty Template -Unique | Sort-Object
$batchGroups   = $certs | Group-Object { $_.ChapterCode + ':::' + $_.Template }

Write-Host "Templates: $($templateSlugs.Count)"
Write-Host "Batches  : $($batchGroups.Count)"

# -------------------------------------------------------------------------
# Build the SQL output
# -------------------------------------------------------------------------
$sb = [System.Text.StringBuilder]::new()

$null = $sb.AppendLine("-- =================================================================")
$null = $sb.AppendLine("-- Legacy certificate import")
$null = $sb.AppendLine("-- Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
$null = $sb.AppendLine("-- Records  : $($certs.Count)  |  Batches: $($batchGroups.Count)  |  Templates: $($templateSlugs.Count)")
$null = $sb.AppendLine("-- =================================================================")
$null = $sb.AppendLine("")

# -------------------------------------------------------------------------
# SECTION 1: placeholder templates (one per color slug)
# -------------------------------------------------------------------------
$null = $sb.AppendLine("-- -----------------------------------------------------------------")
$null = $sb.AppendLine("-- 1. Placeholder templates (idempotent - skip if name already exists)")
$null = $sb.AppendLine("-- -----------------------------------------------------------------")
$null = $sb.AppendLine("DO `$`$")
$null = $sb.AppendLine("DECLARE")
$null = $sb.AppendLine("    v_owner_user_id    UUID;")
$null = $sb.AppendLine("    v_owner_chapter_id UUID;")
$null = $sb.AppendLine("    v_tmpl_id          UUID;")
$null = $sb.AppendLine("    v_ver_id           UUID;")
$null = $sb.AppendLine("    v_slug             TEXT;")
$null = $sb.AppendLine("BEGIN")
$null = $sb.AppendLine("    -- Grab any existing user+chapter pair to satisfy NOT NULL FKs")
$null = $sb.AppendLine("    SELECT u.id, u.chapter_id")
$null = $sb.AppendLine("    INTO   v_owner_user_id, v_owner_chapter_id")
$null = $sb.AppendLine("    FROM   users u")
$null = $sb.AppendLine("    WHERE  u.chapter_id IS NOT NULL")
$null = $sb.AppendLine("    LIMIT  1;")
$null = $sb.AppendLine("")
$null = $sb.AppendLine("    IF v_owner_user_id IS NULL THEN")
$null = $sb.AppendLine("        RAISE EXCEPTION 'No users with a chapter_id found - cannot create placeholder templates';")
$null = $sb.AppendLine("    END IF;")
$null = $sb.AppendLine("")

foreach ($slug in $templateSlugs) {
    $null = $sb.AppendLine("    v_slug := '$slug';")
    $null = $sb.AppendLine("    IF NOT EXISTS (SELECT 1 FROM templates WHERE name = v_slug AND deleted_at IS NULL) THEN")
    $null = $sb.AppendLine("        v_tmpl_id := gen_random_uuid();")
    $null = $sb.AppendLine("        v_ver_id  := gen_random_uuid();")
    $null = $sb.AppendLine("        INSERT INTO templates (id, name, description, owner_user_id, owner_chapter_id,")
    $null = $sb.AppendLine("                               visibility, status, created_at, updated_at)")
    $null = $sb.AppendLine("        VALUES (v_tmpl_id, v_slug, 'Legacy import placeholder',")
    $null = $sb.AppendLine("                v_owner_user_id, v_owner_chapter_id, 'public', 'published', NOW(), NOW());")
    $null = $sb.AppendLine("        INSERT INTO template_versions (id, template_id, version, scene, created_at)")
    $null = $sb.AppendLine("        VALUES (v_ver_id, v_tmpl_id, 1, '{}', NOW());")
    $null = $sb.AppendLine("        UPDATE templates SET current_version_id = v_ver_id WHERE id = v_tmpl_id;")
    $null = $sb.AppendLine("    END IF;")
    $null = $sb.AppendLine("")
}

$null = $sb.AppendLine("END `$`$;")
$null = $sb.AppendLine("")

# -------------------------------------------------------------------------
# SECTION 2: issuance_batches  (one per chapter x template)
# Assign a stable UUID per batch now, then reference it in recipients.
# -------------------------------------------------------------------------
$null = $sb.AppendLine("-- -----------------------------------------------------------------")
$null = $sb.AppendLine("-- 2. Issuance batches (one per chapter x template colour)")
$null = $sb.AppendLine("-- -----------------------------------------------------------------")
$null = $sb.AppendLine("INSERT INTO issuance_batches")
$null = $sb.AppendLine("    (id, chapter_id, template_id, template_version_id, name, cert_name,")
$null = $sb.AppendLine("     status, total_count, success_count, send_mail, is_printable, created_at, updated_at)")
$null = $sb.AppendLine("SELECT")
$null = $sb.AppendLine("    b.batch_id,")
$null = $sb.AppendLine("    c.id  AS chapter_id,")
$null = $sb.AppendLine("    t.id  AS template_id,")
$null = $sb.AppendLine("    tv.id AS template_version_id,")
$null = $sb.AppendLine("    b.batch_name,")
$null = $sb.AppendLine("    b.cert_name,")
$null = $sb.AppendLine("    'completed'::text,")
$null = $sb.AppendLine("    b.total_count,")
$null = $sb.AppendLine("    b.total_count,")
$null = $sb.AppendLine("    false, false,")
$null = $sb.AppendLine("    b.batch_created_at,")
$null = $sb.AppendLine("    NOW()")
$null = $sb.AppendLine("FROM (VALUES")

$batchRows = [System.Collections.Generic.List[string]]::new()
foreach ($grp in $batchGroups) {
    $sep      = $grp.Name.IndexOf(':::')
    $chCode   = $grp.Name.Substring(0, $sep).ToUpper()
    $tmpl     = $grp.Name.Substring($sep + 3)
    $cnt      = $grp.Count
    $minDate  = ($grp.Group | Sort-Object CreatedAt | Select-Object -First 1).CreatedAt
    $batchId  = [System.Guid]::NewGuid().ToString()
    $batchNameEsc = "Legacy Import - $chCode ($tmpl)".Replace("'", "''")
    $batchRows.Add("    ('$batchId'::uuid, '$chCode', '$tmpl', '$batchNameEsc', 'GDGoC 2025', $cnt, '$minDate'::timestamptz)")
    # store batch id on every member cert for section 3
    foreach ($c in $grp.Group) { $c.BatchId = $batchId }
}

$null = $sb.AppendLine(($batchRows -join ",`n"))
$null = $sb.AppendLine(") AS b(batch_id, chap_code, tmpl_slug, batch_name, cert_name, total_count, batch_created_at)")
$null = $sb.AppendLine("JOIN chapters           c  ON upper(c.code)       = upper(b.chap_code)")
$null = $sb.AppendLine("JOIN templates          t  ON t.name              = b.tmpl_slug  AND t.deleted_at IS NULL")
$null = $sb.AppendLine("JOIN template_versions  tv ON tv.template_id      = t.id         AND tv.version = 1")
$null = $sb.AppendLine("ON CONFLICT DO NOTHING;")
$null = $sb.AppendLine("")

# -------------------------------------------------------------------------
# SECTION 3: issuance_recipients
# -------------------------------------------------------------------------
$null = $sb.AppendLine("-- -----------------------------------------------------------------")
$null = $sb.AppendLine("-- 3. Issuance recipients (one per certificate)")
$null = $sb.AppendLine("-- -----------------------------------------------------------------")
$null = $sb.AppendLine("INSERT INTO issuance_recipients")
$null = $sb.AppendLine("    (id, batch_id, email, variables, scripts, status, created_at, updated_at)")
$null = $sb.AppendLine("VALUES")

$recipRows = [System.Collections.Generic.List[string]]::new()
foreach ($cert in $certs) {
    # Build JSONB variables - all relevant legacy fields
    $nameEsc    = $cert.FullName.Replace('\', '\\').Replace('"', '\"')
    $roleEsc    = $cert.Role.Replace('\', '\\').Replace('"', '\"')
    $chapNEsc   = if ($cert.ChapterName) { $cert.ChapterName.Replace('\', '\\').Replace('"', '\"') } else { '' }
    $leadNEsc   = if ($cert.LeaderName)  { $cert.LeaderName.Replace('\', '\\').Replace('"', '\"') }  else { '' }
    $leadCEsc   = if ($cert.LeaderCode)  { $cert.LeaderCode.Replace('\', '\\').Replace('"', '\"') }  else { '' }
    $serialEsc  = $cert.Serial.Replace('\', '\\').Replace('"', '\"')
    $seasonEsc  = if ($cert.GdgSeason)   { $cert.GdgSeason }                                         else { '' }
    $chapCEsc   = $cert.ChapterCode.Replace('\', '\\').Replace('"', '\"')

    $varJson = "{`"name`":`"$nameEsc`",`"role`":`"$roleEsc`",`"chapter_name`":`"$chapNEsc`",`"chapter_code`":`"$chapCEsc`",`"season`":`"$seasonEsc`",`"leader_name`":`"$leadNEsc`",`"leader_code`":`"$leadCEsc`",`"serial`":`"$serialEsc`"}"
    $varJsonSql = $varJson.Replace("'", "''")

    $emailSql  = PgEscape $cert.Email
    $serialSql = PgEscape $cert.Serial

    $recipRows.Add("    ($serialSql, '$($cert.BatchId)'::uuid, $emailSql, '$varJsonSql'::jsonb, '{}'::jsonb, 'rendered', '$($cert.CreatedAt)'::timestamptz, NOW())")
}

$null = $sb.AppendLine(($recipRows -join ",`n"))
$null = $sb.AppendLine("ON CONFLICT (id) DO NOTHING;")
$null = $sb.AppendLine("")

$sql = $sb.ToString()
[System.IO.File]::WriteAllText($outFile, $sql, [System.Text.Encoding]::UTF8)
Write-Host "Written to : $outFile"
Write-Host "SQL size   : $([Math]::Round($sql.Length / 1024, 1)) KB"
Write-Host "Done."
