//go:build !windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

func hideWindow(command *exec.Cmd) {}
func showError(message string) {
	if runtime.GOOS == "darwin" {
		quoted, _ := json.Marshal(message)
		exec.Command("osascript", "-e", "display alert \"Easy Learn\" message "+string(quoted)+" as critical").Run()
	} else {
		fmt.Fprintln(os.Stderr, message)
	}
}
