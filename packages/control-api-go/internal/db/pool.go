package db

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/config"
)

var pool *pgxpool.Pool

// Connect establishes the database connection pool
func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	cfg := config.Get()
	
	// Force disable prepared statements
	dbURL := cfg.DatabaseURL
	if !strings.Contains(dbURL, "statement_cache_mode") {
		if strings.Contains(dbURL, "?") {
			dbURL += "&statement_cache_mode=describe"
		} else {
			dbURL += "?statement_cache_mode=describe"
		}
	}

	poolConfig, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database URL: %w", err)
	}

	// Apply optimized pool settings
	poolConfig.MaxConns = int32(cfg.DBMaxConns)
	poolConfig.MinConns = int32(cfg.DBMinConns)
	poolConfig.MaxConnLifetime = cfg.DBMaxConnLifetime
	poolConfig.MaxConnIdleTime = cfg.DBMaxConnIdleTime
	poolConfig.HealthCheckPeriod = time.Minute
	// Fix for "prepared statement already exists" error (Supabase/Pgbouncer transaction mode)
	poolConfig.ConnConfig.StatementCacheCapacity = 0
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec

	pool, err = pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	fmt.Printf("✅ Database connected (pool: min=%d, max=%d)\n",
		poolConfig.MinConns, poolConfig.MaxConns)

	return pool, nil
}

// GetPool returns the connection pool
func GetPool() *pgxpool.Pool {
	return pool
}

// Close closes the connection pool
func Close() {
	if pool != nil {
		pool.Close()
	}
}

// PoolStats returns current pool statistics
func PoolStats() *pgxpool.Stat {
	if pool != nil {
		return pool.Stat()
	}
	return nil
}
