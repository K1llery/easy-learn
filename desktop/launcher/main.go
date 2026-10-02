package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

func main() {
	if err := launch(); err != nil {
		showError(err.Error())
		os.Exit(1)
	}
}

func launch() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Join(filepath.Dir(executable), "resources")
	if runtime.GOOS == "darwin" {
		root = filepath.Join(filepath.Dir(executable), "..", "Resources")
	}
	data := os.Getenv("EASY_LEARN_DATA_DIR")
	if data == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return err
		}
		if runtime.GOOS == "windows" && os.Getenv("LOCALAPPDATA") != "" {
			base = os.Getenv("LOCALAPPDATA")
		}
		data = filepath.Join(base, "Easy Learn")
	}
	if err := os.MkdirAll(data, 0700); err != nil {
		return fmt.Errorf("无法创建本机数据目录：%w", err)
	}
	log, err := os.OpenFile(filepath.Join(data, "desktop.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer log.Close()
	node := filepath.Join(root, "runtime", "node")
	if runtime.GOOS == "windows" {
		node += ".exe"
	}
	command := exec.Command(node, filepath.Join(root, "desktop.mjs"))
	command.Dir = root
	command.Env = append(os.Environ(), "EASY_LEARN_DATA_DIR="+data)
	command.Stderr = log
	hideWindow(command)
	pipe, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	if err = command.Start(); err != nil {
		return fmt.Errorf("无法启动阅读服务。请重新解压完整的软件包：%w", err)
	}
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(pipe)
		if scanner.Scan() {
			ready <- scanner.Text()
		} else {
			ready <- ""
		}
		for scanner.Scan() {
		}
	}()
	var line string
	select {
	case line = <-ready:
	case <-time.After(20 * time.Second):
		command.Process.Kill()
		command.Wait()
		return fmt.Errorf("阅读服务启动超时，请查看 %s", filepath.Join(data, "desktop.log"))
	}
	var result struct {
		URL string `json:"url"`
	}
	if json.Unmarshal([]byte(line), &result) != nil {
		command.Process.Kill()
		command.Wait()
		return fmt.Errorf("阅读服务启动失败，请查看 %s", filepath.Join(data, "desktop.log"))
	}
	parsed, err := url.Parse(result.URL)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Port() == "" {
		command.Process.Kill()
		command.Wait()
		return fmt.Errorf("阅读服务返回了无效地址")
	}
	if os.Getenv("EASY_LEARN_NO_BROWSER") == "1" {
		fmt.Println(result.URL)
	} else {
		var browser *exec.Cmd
		switch runtime.GOOS {
		case "windows":
			browser = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", result.URL)
		case "darwin":
			browser = exec.Command("open", result.URL)
		default:
			browser = exec.Command("xdg-open", result.URL)
		}
		hideWindow(browser)
		if err = browser.Run(); err != nil {
			showError("无法自动打开浏览器，请手动打开：" + result.URL)
		}
	}
	// The backend owns its lifetime. Exit so Finder starts a fresh launcher on
	// every open, rather than sending an unhandled reopen event to this process.
	return command.Process.Release()
}
