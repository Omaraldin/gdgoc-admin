package database

import (
	_ "embed"
	"fmt"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

//go:embed migrations/schema.sql
var schemaSQL string

// DB wraps gorm.DB for use across the application.
type DB struct {
	Gorm *gorm.DB
}

func Connect(databaseURL string, maxOpenConns, maxIdleConns, maxLifetimeMins int) (*DB, error) {
	gdb, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, fmt.Errorf("get sql.DB: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("database ping failed: %w", err)
	}
	sqlDB.SetMaxOpenConns(maxOpenConns)
	sqlDB.SetMaxIdleConns(maxIdleConns)
	sqlDB.SetConnMaxLifetime(time.Duration(maxLifetimeMins) * time.Minute)
	return &DB{Gorm: gdb}, nil
}

func (db *DB) Close() {
	if sqlDB, err := db.Gorm.DB(); err == nil {
		sqlDB.Close()
	}
}

// Migrate applies the embedded schema.sql idempotently.
// All DDL uses IF NOT EXISTS guards, so this is safe to call on every startup.
func Migrate(db *DB) error {
	sqlDB, err := db.Gorm.DB()
	if err != nil {
		return fmt.Errorf("get sql.DB: %w", err)
	}
	for _, stmt := range splitSQL(schemaSQL) {
		if _, err := sqlDB.Exec(stmt); err != nil {
			return fmt.Errorf("schema apply failed: %w\nstatement:\n%s", err, stmt)
		}
	}
	return nil
}

// splitSQL splits a SQL string into individual statements, correctly handling
// PostgreSQL $$ dollar-quoted blocks (used by DO $$ ... $$ statements).
func splitSQL(sql string) []string {
	var stmts []string
	var buf strings.Builder
	inDollarQuote := false

	for i := 0; i < len(sql); i++ {
		// Detect opening or closing $$ delimiter.
		if i+1 < len(sql) && sql[i] == '$' && sql[i+1] == '$' {
			inDollarQuote = !inDollarQuote
			buf.WriteByte(sql[i])
			buf.WriteByte(sql[i+1])
			i++ // skip second '$'
			continue
		}
		// Statement terminator — only split when outside dollar-quoted blocks.
		if sql[i] == ';' && !inDollarQuote {
			if stmt := strings.TrimSpace(buf.String()); stmt != "" {
				stmts = append(stmts, stmt)
			}
			buf.Reset()
			continue
		}
		buf.WriteByte(sql[i])
	}
	if stmt := strings.TrimSpace(buf.String()); stmt != "" {
		stmts = append(stmts, stmt)
	}
	return stmts
}
