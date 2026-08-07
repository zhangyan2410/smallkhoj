// Command aura-launcher is the Windows user-facing executable for the Aura
// daemon. It is a thin process-replacing wrapper: it locates the private
// node.exe shipped next to it and runs the daemon entrypoint
// dist/cmd/main.js with the caller's arguments unchanged.
//
// The launcher intentionally does NOT interpret subcommands or flags. Every
// argument is forwarded verbatim to the Node CLI, so setup / start / status /
// stop / connect and any future command keep identical semantics to the
// Node-only distribution. Its only jobs are:
//
//  1. Find the bundled node.exe relative to its own executable path, so the
//     target computer never needs a system Node.js/npm/npx install.
//  2. Set AURA_STANDALONE=1 so the daemon reports implementationType
//     "aura-standalone" in `status --json` (see src/cmd/main.ts
//     detectImplementationType).
//  3. Forward stdio and the child exit code, preserving the load-bearing
//     `status` exit-code contract (running -> 0, stopped -> 1).
//
// This is a build/release artifact, not part of everyday TypeScript/Node
// development. Build with: GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

const (
	// entrypointRelative is the daemon CLI entrypoint shipped in the
	// versioned install directory. Kept as a plain string so it can be used
	// in a const context; filepath.Join is applied at the call sites.
	entrypointRelative = "dist/cmd/main.js"
	nodeExeName        = "node.exe"
)

// resolveNodeRuntime locates the bundled node.exe. It first looks next to this
// executable (the standalone versioned-directory layout), then falls back to
// the AURA_NODE_RUNTIME override so tests and diagnostics can point elsewhere.
func resolveNodeRuntime(selfDir string) (string, error) {
	if override := os.Getenv("AURA_NODE_RUNTIME"); override != "" {
		if _, err := os.Stat(override); err == nil {
			return override, nil
		}
	}
	candidate := filepath.Join(selfDir, nodeExeName)
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		return candidate, nil
	}
	return "", fmt.Errorf(
		"aura launcher could not find the bundled %s next to %s; set AURA_NODE_RUNTIME to a node.exe path",
		nodeExeName, selfDir,
	)
}

func main() {
	self, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "aura: cannot resolve own executable path: %v\n", err)
		os.Exit(1)
	}
	selfDir := filepath.Dir(self)

	nodeExe, err := resolveNodeRuntime(selfDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	entrypoint := filepath.Join(selfDir, entrypointRelative)
	if _, err := os.Stat(entrypoint); err != nil {
		fmt.Fprintf(os.Stderr, "aura: daemon entrypoint not found at %s\n", entrypoint)
		os.Exit(1)
	}

	args := append([]string{entrypoint}, os.Args[1:]...)

	cmd := exec.Command(nodeExe, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Inherit the full environment and mark this as a standalone install so
	// the daemon CLI reports implementationType=aura-standalone. Preserve any
	// explicit override a caller already set (e.g. diagnostics forcing the
	// node-npx label).
	env := os.Environ()
	if os.Getenv("AURA_STANDALONE") == "" {
		env = append(env, "AURA_STANDALONE=1")
	}
	cmd.Env = env

	// Run in the launcher's directory so relative daemon paths (dist/,
	// package.json, node_modules) resolve the same way the Node CLI expects
	// when invoked from its install root.
	cmd.Dir = selfDir

	if err := cmd.Run(); err != nil {
		// Surface a non-zero exit code from the child. `status` relies on the
		// daemon's own exit semantics (running=0, stopped=1); do not mask it.
		if exitErr, ok := err.(*exec.ExitError); ok {
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				os.Exit(status.ExitStatus())
			}
			os.Exit(exitErr.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "aura: failed to run node: %v\n", err)
		os.Exit(1)
	}
}
