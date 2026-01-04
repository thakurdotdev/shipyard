package db

import "strings"

func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}

func containsParam(url, param string) bool {
	return strings.Contains(url, param+"=")
}
