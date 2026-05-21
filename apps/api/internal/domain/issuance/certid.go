package issuance

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"
)

const certIDAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// GenerateCertificateID produces a human-readable certificate ID in the form:
//
//	{CHAPTER_CODE}-GDG{YY}-{LEADER_CODENAME}-{RANDOM6}
//
// where YY = last two digits of the current year (e.g. 26 for 2026).
func GenerateCertificateID(chapterCode string, leaderCodename string) string {
	yy := time.Now().Year() % 100
	return fmt.Sprintf("%s-GDG%02d-%s-%s",
		strings.ToUpper(chapterCode),
		yy,
		strings.ToUpper(leaderCodename),
		randomSuffix(6),
	)
}

func randomSuffix(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("certid: failed to read random bytes: " + err.Error())
	}
	out := make([]byte, n)
	for i, v := range b {
		out[i] = certIDAlphabet[int(v)%len(certIDAlphabet)]
	}
	return string(out)
}
