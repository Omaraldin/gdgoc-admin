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
//	{CHAPTER_CODE}-GDG{YEARS_ACTIVE}-{LEADER_CODENAME}-{RANDOM6}
//
// where YEARS_ACTIVE = current year − chapter's founding year.
// If sinceYear is nil (not set), the age component is 0.
func GenerateCertificateID(chapterCode string, sinceYear *int, leaderCodename string) string {
	age := 0
	if sinceYear != nil {
		age = time.Now().Year() - *sinceYear
	}
	return fmt.Sprintf("%s-GDG%02d-%s-%s",
		strings.ToUpper(chapterCode),
		age,
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
