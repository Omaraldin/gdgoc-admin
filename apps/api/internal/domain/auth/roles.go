package auth

const (
	RoleSuperAdmin    = "super_admin"
	RoleChapterLeader = "chapter_leader"
	RoleEditor        = "editor"
)

func IsValidRole(role string) bool {
	switch role {
	case RoleSuperAdmin, RoleChapterLeader, RoleEditor:
		return true
	default:
		return false
	}
}

func IsSuperAdmin(role string) bool {
	return role == RoleSuperAdmin
}

func IsChapterLeader(role string) bool {
	return role == RoleChapterLeader
}

func IsEditor(role string) bool {
	return role == RoleEditor
}
