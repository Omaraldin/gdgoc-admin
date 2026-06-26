package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// SMTPConfig holds the email-sending configuration for a chapter.
// Callers must populate the fields relevant to the chosen Provider.
type SMTPConfig struct {
	Provider    string // "gmail" | "outlook" | "manual"
	FromEmail   string // the From: address used in the envelope and header
	ChapterName string // display name used in the email footer

	// Manual SMTP fields (provider == "manual")
	Host     string
	Port     int
	Username string // SMTP auth username (often the same as FromEmail)
	Password string

	// OAuth2 field (provider == "gmail" | "outlook")
	RefreshToken string
}

// OAuthCreds holds the application-level OAuth2 client credentials.
// These come from environment variables and are shared across all chapters.
type OAuthCreds struct {
	GoogleClientID        string
	GoogleClientSecret    string
	MicrosoftClientID     string
	MicrosoftClientSecret string
}

// MailAttachment is a named file attachment to include in an outgoing email.
type MailAttachment struct {
	Filename    string // e.g. "certificate.png"
	ContentType string // e.g. "image/png"
	Data        []byte
}

// SendMail sends a single email using the provider specified in smtpCfg.
// For Gmail/Outlook it refreshes the access token on every call; for manual
// mode it uses SMTP PlainAuth.
func SendMail(to, subject, body string, isHTML bool, smtpCfg SMTPConfig, oauthCreds OAuthCreds) error {
	return SendMailWithAttachments(to, subject, body, isHTML, smtpCfg, oauthCreds, nil)
}

// SendMailWithAttachments is like SendMail but also attaches the given files.
func SendMailWithAttachments(to, subject, body string, isHTML bool, smtpCfg SMTPConfig, oauthCreds OAuthCreds, attachments []MailAttachment) error {
	switch smtpCfg.Provider {
	case "gmail":
		accessToken, err := RefreshAccessToken("gmail", oauthCreds.GoogleClientID, oauthCreds.GoogleClientSecret, smtpCfg.RefreshToken)
		if err != nil {
			return fmt.Errorf("refresh gmail token: %w", err)
		}
		return sendViaSMTPXOAuth2WithAttachments("smtp.gmail.com", 587, smtpCfg.FromEmail, accessToken, to, subject, body, isHTML, smtpCfg.ChapterName, attachments)
	case "outlook":
		accessToken, err := RefreshAccessToken("outlook", oauthCreds.MicrosoftClientID, oauthCreds.MicrosoftClientSecret, smtpCfg.RefreshToken)
		if err != nil {
			return fmt.Errorf("refresh outlook token: %w", err)
		}
		return sendViaSMTPXOAuth2WithAttachments("smtp.office365.com", 587, smtpCfg.FromEmail, accessToken, to, subject, body, isHTML, smtpCfg.ChapterName, attachments)
	case "manual":
		return sendViaPlainAuthWithAttachments(smtpCfg.Host, smtpCfg.Port, smtpCfg.Username, smtpCfg.Password, smtpCfg.FromEmail, to, subject, body, isHTML, smtpCfg.ChapterName, attachments)
	default:
		return fmt.Errorf("unknown smtp provider %q", smtpCfg.Provider)
	}
}

// RefreshAccessToken exchanges a stored refresh token for a new short-lived
// access token using the provider's token endpoint.
func RefreshAccessToken(provider, clientID, clientSecret, refreshToken string) (string, error) {
	tokenURL, err := providerTokenURL(provider)
	if err != nil {
		return "", err
	}
	resp, err := http.PostForm(tokenURL, url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"refresh_token": {refreshToken},
		"grant_type":    {"refresh_token"},
	})
	if err != nil {
		return "", fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token endpoint %d: %s", resp.StatusCode, raw)
	}
	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("parse token response: %w", err)
	}
	if result.Error != "" {
		return "", fmt.Errorf("token error %s: %s", result.Error, result.ErrorDesc)
	}
	return result.AccessToken, nil
}

// ExchangeCodeForTokens exchanges an OAuth2 authorization code for an
// access token and a refresh token.
func ExchangeCodeForTokens(provider, code, redirectURI, clientID, clientSecret string) (accessToken, refreshToken string, err error) {
	tokenURL, err := providerTokenURL(provider)
	if err != nil {
		return "", "", err
	}
	resp, err := http.PostForm(tokenURL, url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"grant_type":    {"authorization_code"},
	})
	if err != nil {
		return "", "", fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("token endpoint %d: %s", resp.StatusCode, raw)
	}
	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", "", fmt.Errorf("parse token response: %w", err)
	}
	if result.Error != "" {
		return "", "", fmt.Errorf("token error %s: %s", result.Error, result.ErrorDesc)
	}
	if result.RefreshToken == "" {
		return "", "", fmt.Errorf("provider did not return a refresh token (ensure offline_access scope is requested)")
	}
	return result.AccessToken, result.RefreshToken, nil
}

// GetOAuthUserEmail fetches the email address of the authenticated user from
// the provider's userinfo endpoint using the given access token.
func GetOAuthUserEmail(provider, accessToken string) (string, error) {
	var userInfoURL string
	switch provider {
	case "gmail":
		userInfoURL = "https://www.googleapis.com/oauth2/v3/userinfo"
	case "outlook":
		userInfoURL = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName"
	default:
		return "", fmt.Errorf("unsupported provider: %s", provider)
	}

	req, err := http.NewRequest(http.MethodGet, userInfoURL, nil)
	if err != nil {
		return "", fmt.Errorf("build userinfo request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("userinfo request: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("parse userinfo: %w", err)
	}

	var email string
	if provider == "gmail" {
		email, _ = result["email"].(string)
	} else {
		// Microsoft Graph: prefer "mail", fall back to "userPrincipalName"
		email, _ = result["mail"].(string)
		if email == "" {
			email, _ = result["userPrincipalName"].(string)
		}
	}
	if email == "" {
		return "", fmt.Errorf("could not retrieve email from %s userinfo", provider)
	}
	return email, nil
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

// xoauth2 implements smtp.Auth for the XOAUTH2 mechanism used by Gmail and
// Outlook when authenticating over STARTTLS.
type xoauth2 struct {
	user        string
	accessToken string
}

func (a *xoauth2) Start(_ *smtp.ServerInfo) (string, []byte, error) {
	payload := "user=" + a.user + "\x01auth=Bearer " + a.accessToken + "\x01\x01"
	return "XOAUTH2", []byte(payload), nil
}

func (a *xoauth2) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return nil, fmt.Errorf("unexpected server challenge in XOAUTH2")
	}
	return nil, nil
}

func sendViaSMTPXOAuth2(host string, port int, fromEmail, accessToken, to, subject, body string, isHTML bool, chapterName string) error {
	return sendViaSMTPXOAuth2WithAttachments(host, port, fromEmail, accessToken, to, subject, body, isHTML, chapterName, nil)
}

func sendViaSMTPXOAuth2WithAttachments(host string, port int, fromEmail, accessToken, to, subject, body string, isHTML bool, chapterName string, attachments []MailAttachment) error {
	auth := &xoauth2{user: fromEmail, accessToken: accessToken}
	return smtpSend(host, port, auth, fromEmail, to, subject, body, isHTML, chapterName, attachments)
}

func sendViaPlainAuth(host string, port int, username, password, fromEmail, to, subject, body string, isHTML bool, chapterName string) error {
	return sendViaPlainAuthWithAttachments(host, port, username, password, fromEmail, to, subject, body, isHTML, chapterName, nil)
}

func sendViaPlainAuthWithAttachments(host string, port int, username, password, fromEmail, to, subject, body string, isHTML bool, chapterName string, attachments []MailAttachment) error {
	auth := smtp.PlainAuth("", username, password, host)
	return smtpSend(host, port, auth, fromEmail, to, subject, body, isHTML, chapterName, attachments)
}

// ---------------------------------------------------------------------------
// SSRF-safe HTTP client used for fetching external images in email bodies.
// ---------------------------------------------------------------------------

// privateIPNets contains the CIDR ranges that must never be fetched.
var privateIPNets = func() []net.IPNet {
	blocks := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",
		"169.254.0.0/16", // link-local
		"::1/128",        // IPv6 loopback
		"fc00::/7",       // IPv6 ULA
	}
	nets := make([]net.IPNet, 0, len(blocks))
	for _, b := range blocks {
		_, ipNet, err := net.ParseCIDR(b)
		if err == nil {
			nets = append(nets, *ipNet)
		}
	}
	return nets
}()

func isPrivateIP(ip net.IP) bool {
	for _, block := range privateIPNets {
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

// safeDialContext is a custom dialer that resolves the target host and rejects
// connections to private/internal IP ranges to prevent SSRF.
func safeDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("no addresses resolved for %s", host)
	}
	for _, a := range addrs {
		if isPrivateIP(a.IP) {
			return nil, fmt.Errorf("image host %q resolves to a private/internal address", host)
		}
	}
	return (&net.Dialer{}).DialContext(ctx, network, net.JoinHostPort(addrs[0].IP.String(), port))
}

// safeHTTPClient is used by fetchAndEmbedImages to fetch external image URLs.
// It uses safeDialContext to block requests to private/internal hosts (SSRF).
var safeHTTPClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		DialContext:           safeDialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		MaxIdleConns:          10,
	},
}

// ---------------------------------------------------------------------------
// HTML email helpers: layout wrapper + inline image embedding
// ---------------------------------------------------------------------------

// randomHex returns n random hex bytes, used for Message-ID and MIME boundaries.
func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// Fallback: time-based — still better than nothing.
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", b)
}

// messageID builds a unique RFC 2822 Message-ID using the sender's domain.
func messageID(fromEmail string) string {
	domain := "mail.local"
	if idx := strings.LastIndex(fromEmail, "@"); idx >= 0 {
		domain = fromEmail[idx+1:]
	}
	return fmt.Sprintf("<%s@%s>", randomHex(16), domain)
}

// formatDate returns the current time formatted per RFC 2822.
func formatDate() string {
	return time.Now().UTC().Format("Mon, 02 Jan 2006 15:04:05 +0000")
}

// displayFrom formats the From header as "Display Name <email>" when a chapter
// name is available, which looks more human and scores better with spam filters.
func displayFrom(email, chapterName string) string {
	if chapterName == "" {
		return email
	}
	return fmt.Sprintf("%s <%s>", chapterName, email)
}

// inlineImage holds a single image to be embedded in a multipart/related message.
type inlineImage struct {
	cid         string
	contentType string
	data        []byte
}

// imgSrcRe matches src="http(s)://..." or src='http(s)://...' attributes inside <img> tags.
var imgSrcRe = regexp.MustCompile(`(?i)src\s*=\s*("https?://[^"]+"|'https?://[^']+')`)

// imgTagRe matches <img ...> and <img ... /> tags.
var imgTagRe = regexp.MustCompile(`(?i)<img\b([^>]*?)(\s*/?>)`)

// constrainImages injects max-width:100%;height:auto; into every <img> tag
// so images are contained within the 600px email column.
func constrainImages(html string) string {
	return imgTagRe.ReplaceAllStringFunc(html, func(match string) string {
		subs := imgTagRe.FindStringSubmatch(match)
		if len(subs) < 3 {
			return match
		}
		attrs, closing := subs[1], subs[2]
		if i := strings.Index(strings.ToLower(attrs), `style="`); i >= 0 {
			insertAt := i + len(`style="`)
			return "<img" + attrs[:insertAt] + "max-width:100%;height:auto;" + attrs[insertAt:] + closing
		}
		return "<img" + attrs + ` style="max-width:100%;height:auto;"` + closing
	})
}

// fetchAndEmbedImages replaces external image URLs in the HTML body with
// cid: references and returns the fetched images as inline attachments.
// Images that cannot be fetched are left as external URLs.
func fetchAndEmbedImages(htmlBody string) (string, []inlineImage) {
	type result struct {
		cid         string
		contentType string
		data        []byte
		ok          bool
	}

	urlMap := make(map[string]*result)
	counter := 0
	for _, m := range imgSrcRe.FindAllStringSubmatch(htmlBody, -1) {
		if len(m) < 2 {
			continue
		}
		srcURL := strings.Trim(m[1], `"'`)
		if _, seen := urlMap[srcURL]; !seen {
			counter++
			urlMap[srcURL] = &result{cid: fmt.Sprintf("img%04d@mail.local", counter)}
		}
	}
	if len(urlMap) == 0 {
		return htmlBody, nil
	}

	for srcURL, res := range urlMap {
		resp, err := safeHTTPClient.Get(srcURL)
		if err != nil || resp.StatusCode != http.StatusOK {
			if resp != nil {
				resp.Body.Close()
			}
			continue
		}
		data, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue
		}
		ct := resp.Header.Get("Content-Type")
		if ct == "" {
			ct = http.DetectContentType(data)
		}
		res.data = data
		res.contentType = ct
		res.ok = true
	}

	modified := imgSrcRe.ReplaceAllStringFunc(htmlBody, func(match string) string {
		sub := imgSrcRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		srcURL := strings.Trim(sub[1], `"'`)
		if res, ok := urlMap[srcURL]; ok && res.ok {
			quote := sub[1][:1]
			return `src=` + quote + `cid:` + res.cid + quote
		}
		return match
	})

	var attachments []inlineImage
	for _, res := range urlMap {
		if res.ok {
			attachments = append(attachments, inlineImage{cid: res.cid, contentType: res.contentType, data: res.data})
		}
	}
	return modified, attachments
}

// wrapInEmailLayout wraps raw HTML body content in a centered, email-safe table layout.
func wrapInEmailLayout(body, chapterName string) string {
	if chapterName == "" {
		chapterName = "Google Developer Groups on Campus"
	}
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:40px 48px;color:#111827;font-size:15px;line-height:1.7;">
              ` + body + `
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 48px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">Google Developer Groups on Campus: ` + chapterName + `</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// buildHTMLMIMEMessage constructs the full RFC 2822 message bytes for an HTML email.
// It wraps the body in a centered layout and embeds any external images inline.
func buildHTMLMIMEMessage(from, to, subject, htmlBody, chapterName string) []byte {
	wrapped := wrapInEmailLayout(constrainImages(htmlBody), chapterName)
	embedded, images := fetchAndEmbedImages(wrapped)

	var buf bytes.Buffer
	buf.WriteString("From: " + displayFrom(from, chapterName) + "\r\n")
	buf.WriteString("To: " + to + "\r\n")
	buf.WriteString("Subject: " + subject + "\r\n")
	buf.WriteString("Date: " + formatDate() + "\r\n")
	buf.WriteString("Message-ID: " + messageID(from) + "\r\n")
	buf.WriteString("MIME-Version: 1.0\r\n")
	buf.WriteString("X-Mailer: GDGoC Admin\r\n")

	if len(images) == 0 {
		buf.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
		buf.WriteString(embedded)
		return buf.Bytes()
	}

	boundary := "=_rel_" + randomHex(16)
	buf.WriteString(fmt.Sprintf("Content-Type: multipart/related; type=\"text/html\"; boundary=\"%s\"\r\n\r\n", boundary))

	// HTML part
	buf.WriteString("--" + boundary + "\r\n")
	buf.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	buf.WriteString(embedded)
	buf.WriteString("\r\n")

	// Inline image parts
	for _, img := range images {
		buf.WriteString("--" + boundary + "\r\n")
		buf.WriteString("Content-Type: " + img.contentType + "\r\n")
		buf.WriteString("Content-Transfer-Encoding: base64\r\n")
		buf.WriteString("Content-ID: <" + img.cid + ">\r\n")
		buf.WriteString("Content-Disposition: inline\r\n\r\n")
		enc := base64.StdEncoding.EncodeToString(img.data)
		for i := 0; i < len(enc); i += 76 {
			end := i + 76
			if end > len(enc) {
				end = len(enc)
			}
			buf.WriteString(enc[i:end])
			buf.WriteString("\r\n")
		}
	}
	buf.WriteString("--" + boundary + "--\r\n")
	return buf.Bytes()
}

// buildMixedMIMEMessage wraps the HTML (or plain-text) body in a
// multipart/mixed envelope and appends each attachment as a separate part.
//
// Structure for HTML with inline images + attachments:
//
//	multipart/mixed
//	  └─ multipart/related
//	       ├─ text/html  (cid: references for any embedded images)
//	       └─ inline image parts
//	  └─ file attachment parts
func buildMixedMIMEMessage(from, to, subject, body string, isHTML bool, chapterName string, attachments []MailAttachment) []byte {
	mixedBoundary := "=_mixed_" + randomHex(16)

	var buf bytes.Buffer
	buf.WriteString("From: " + displayFrom(from, chapterName) + "\r\n")
	buf.WriteString("To: " + to + "\r\n")
	buf.WriteString("Subject: " + subject + "\r\n")
	buf.WriteString("Date: " + formatDate() + "\r\n")
	buf.WriteString("Message-ID: " + messageID(from) + "\r\n")
	buf.WriteString("MIME-Version: 1.0\r\n")
	buf.WriteString("X-Mailer: GDGoC Admin\r\n")
	buf.WriteString(fmt.Sprintf("Content-Type: multipart/mixed; boundary=\"%s\"\r\n\r\n", mixedBoundary))

	// ── body part ────────────────────────────────────────────────────────────
	buf.WriteString("--" + mixedBoundary + "\r\n")
	if isHTML {
		wrapped := wrapInEmailLayout(constrainImages(body), chapterName)
		embedded, images := fetchAndEmbedImages(wrapped)

		if len(images) == 0 {
			// Simple HTML part — no inline images.
			buf.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
			buf.WriteString(embedded)
		} else {
			// multipart/related so inline images stay with their HTML.
			relBoundary := "=_rel_" + randomHex(16)
			buf.WriteString(fmt.Sprintf("Content-Type: multipart/related; type=\"text/html\"; boundary=\"%s\"\r\n\r\n", relBoundary))

			buf.WriteString("--" + relBoundary + "\r\n")
			buf.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
			buf.WriteString(embedded)
			buf.WriteString("\r\n")

			for _, img := range images {
				buf.WriteString("--" + relBoundary + "\r\n")
				buf.WriteString("Content-Type: " + img.contentType + "\r\n")
				buf.WriteString("Content-Transfer-Encoding: base64\r\n")
				buf.WriteString("Content-ID: <" + img.cid + ">\r\n")
				buf.WriteString("Content-Disposition: inline\r\n\r\n")
				enc := base64.StdEncoding.EncodeToString(img.data)
				for i := 0; i < len(enc); i += 76 {
					end := i + 76
					if end > len(enc) {
						end = len(enc)
					}
					buf.WriteString(enc[i:end])
					buf.WriteString("\r\n")
				}
			}
			buf.WriteString("--" + relBoundary + "--\r\n")
		}
	} else {
		buf.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
		buf.WriteString(body)
	}
	buf.WriteString("\r\n")

	// ── attachment parts ─────────────────────────────────────────────────────
	for _, att := range attachments {
		buf.WriteString("--" + mixedBoundary + "\r\n")
		buf.WriteString("Content-Type: " + att.ContentType + "\r\n")
		buf.WriteString("Content-Transfer-Encoding: base64\r\n")
		buf.WriteString(fmt.Sprintf("Content-Disposition: attachment; filename=\"%s\"\r\n\r\n", att.Filename))
		enc := base64.StdEncoding.EncodeToString(att.Data)
		for i := 0; i < len(enc); i += 76 {
			end := i + 76
			if end > len(enc) {
				end = len(enc)
			}
			buf.WriteString(enc[i:end])
			buf.WriteString("\r\n")
		}
	}
	buf.WriteString("--" + mixedBoundary + "--\r\n")
	return buf.Bytes()
}

// smtpSend dials the SMTP server, upgrades to TLS (implicit on port 465,
// STARTTLS otherwise), authenticates, and delivers the message.
func smtpSend(host string, port int, auth smtp.Auth, from, to, subject, body string, isHTML bool, chapterName string, attachments []MailAttachment) error {
	addr := fmt.Sprintf("%s:%d", host, port)

	var msg []byte
	if len(attachments) > 0 {
		msg = buildMixedMIMEMessage(from, to, subject, body, isHTML, chapterName, attachments)
	} else if isHTML {
		msg = buildHTMLMIMEMessage(from, to, subject, body, chapterName)
	} else {
		msg = []byte(fmt.Sprintf(
			"From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMessage-ID: %s\r\nMIME-Version: 1.0\r\nX-Mailer: GDGoC Admin\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
			displayFrom(from, chapterName), to, subject, formatDate(), messageID(from), body,
		))
	}

	var c *smtp.Client
	var err error

	if port == 465 {
		// Implicit TLS (SMTPS)
		conn, dialErr := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
		if dialErr != nil {
			return fmt.Errorf("tls dial: %w", dialErr)
		}
		c, err = smtp.NewClient(conn, host)
		if err != nil {
			conn.Close()
			return fmt.Errorf("smtp client: %w", err)
		}
	} else {
		// STARTTLS (port 587 / 25)
		c, err = smtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("smtp dial: %w", err)
		}
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(&tls.Config{ServerName: host}); err != nil {
				c.Close()
				return fmt.Errorf("starttls: %w", err)
			}
		}
	}
	defer c.Close()

	if err := c.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	return w.Close()
}

// ProbeConnection verifies that the SMTP config is currently usable:
//   - OAuth providers: attempts a token refresh (catches expired/revoked tokens)
//   - Manual SMTP: dials the server, completes STARTTLS/TLS, authenticates, then sends QUIT
//
// Returns nil when the config is working, an error otherwise.
func ProbeConnection(cfg SMTPConfig, oauthCreds OAuthCreds) error {
	switch cfg.Provider {
	case "gmail":
		_, err := RefreshAccessToken("gmail", oauthCreds.GoogleClientID, oauthCreds.GoogleClientSecret, cfg.RefreshToken)
		return err
	case "outlook":
		_, err := RefreshAccessToken("outlook", oauthCreds.MicrosoftClientID, oauthCreds.MicrosoftClientSecret, cfg.RefreshToken)
		return err
	case "manual":
		addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
		auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
		var c *smtp.Client
		var err error
		if cfg.Port == 465 {
			conn, dialErr := tls.Dial("tcp", addr, &tls.Config{ServerName: cfg.Host})
			if dialErr != nil {
				return fmt.Errorf("probe tls dial: %w", dialErr)
			}
			c, err = smtp.NewClient(conn, cfg.Host)
			if err != nil {
				conn.Close()
				return fmt.Errorf("probe smtp client: %w", err)
			}
		} else {
			c, err = smtp.Dial(addr)
			if err != nil {
				return fmt.Errorf("probe smtp dial: %w", err)
			}
			if ok, _ := c.Extension("STARTTLS"); ok {
				if err := c.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
					c.Close()
					return fmt.Errorf("probe starttls: %w", err)
				}
			}
		}
		defer c.Close()
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("probe auth: %w", err)
		}
		return c.Quit()
	default:
		return fmt.Errorf("unknown provider %q", cfg.Provider)
	}
}

func providerTokenURL(provider string) (string, error) {
	switch provider {
	case "gmail":
		return "https://oauth2.googleapis.com/token", nil
	case "outlook":
		return "https://login.microsoftonline.com/common/oauth2/v2.0/token", nil
	default:
		return "", fmt.Errorf("unsupported oauth provider: %s", provider)
	}
}
