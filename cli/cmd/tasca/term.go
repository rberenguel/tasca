//go:build darwin || linux

package main

import (
	"syscall"
	"unsafe"
)

type termState struct {
	termios syscall.Termios
}

func enableRawMode() (*termState, error) {
	var old syscall.Termios
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL,
		uintptr(syscall.Stdin),
		ioctlReadTermios,
		uintptr(unsafe.Pointer(&old))); errno != 0 {
		return nil, errno
	}

	raw := old
	// cfmakeraw equivalent
	raw.Iflag &^= syscall.IGNBRK | syscall.BRKINT | syscall.PARMRK |
		syscall.ISTRIP | syscall.INLCR | syscall.IGNCR | syscall.ICRNL | syscall.IXON
	raw.Oflag &^= syscall.OPOST
	raw.Lflag &^= syscall.ECHO | syscall.ECHONL | syscall.ICANON | syscall.ISIG | syscall.IEXTEN
	raw.Cflag &^= syscall.CSIZE | syscall.PARENB
	raw.Cflag |= syscall.CS8
	raw.Cc[syscall.VMIN] = 1
	raw.Cc[syscall.VTIME] = 0

	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL,
		uintptr(syscall.Stdin),
		ioctlWriteTermios,
		uintptr(unsafe.Pointer(&raw))); errno != 0 {
		return nil, errno
	}

	return &termState{old}, nil
}

func disableRawMode(state *termState) {
	if state == nil {
		return
	}
	syscall.Syscall(syscall.SYS_IOCTL,
		uintptr(syscall.Stdin),
		ioctlWriteTermios,
		uintptr(unsafe.Pointer(&state.termios)))
}
