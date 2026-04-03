package main

import (
	"image/color"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/theme"
)

// Colors from DESIGN.md
var (
	colorSurface          = color.NRGBA{R: 0x11, G: 0x13, B: 0x19, A: 0xFF}
	colorSurfaceContainer = color.NRGBA{R: 0x19, G: 0x1D, B: 0x27, A: 0xFF}
	colorPrimary          = color.NRGBA{R: 0x91, G: 0xDB, B: 0x37, A: 0xFF}
	colorSecondary        = color.NRGBA{R: 0xAD, G: 0xC6, B: 0xFF, A: 0xFF}
	colorForeground       = color.NRGBA{R: 0xE2, G: 0xE2, B: 0xE5, A: 0xFF}
	colorForegroundDim    = color.NRGBA{R: 0x8A, G: 0x8D, B: 0x96, A: 0xFF}
	colorError            = color.NRGBA{R: 0xFF, G: 0x6B, B: 0x6B, A: 0xFF}
	colorInputBg          = color.NRGBA{R: 0x1F, G: 0x23, B: 0x2F, A: 0xFF}
)

type pomodoroTheme struct{}

func (t *pomodoroTheme) Color(name fyne.ThemeColorName, variant fyne.ThemeVariant) color.Color {
	switch name {
	case theme.ColorNameBackground:
		return colorSurface
	case theme.ColorNameButton:
		return colorPrimary
	case theme.ColorNameForeground:
		return colorForeground
	case theme.ColorNamePrimary:
		return colorPrimary
	case theme.ColorNameDisabled:
		return colorForegroundDim
	case theme.ColorNamePlaceHolder:
		return colorForegroundDim
	case theme.ColorNameScrollBar:
		return colorForegroundDim
	case theme.ColorNameInputBackground:
		return colorInputBg
	case theme.ColorNameInputBorder:
		return colorSurfaceContainer
	case theme.ColorNameSeparator:
		return colorSurfaceContainer
	case theme.ColorNameError:
		return colorError
	case theme.ColorNameOverlayBackground:
		return colorSurfaceContainer
	case theme.ColorNameMenuBackground:
		return colorSurfaceContainer
	case theme.ColorNameHover:
		return color.NRGBA{R: 0x91, G: 0xDB, B: 0x37, A: 0x33}
	case theme.ColorNameFocus:
		return color.NRGBA{R: 0x91, G: 0xDB, B: 0x37, A: 0x55}
	case theme.ColorNameSelection:
		return color.NRGBA{R: 0x91, G: 0xDB, B: 0x37, A: 0x44}
	case theme.ColorNameHeaderBackground:
		return colorSurfaceContainer
	}
	return theme.DefaultTheme().Color(name, variant)
}

func (t *pomodoroTheme) Font(style fyne.TextStyle) fyne.Resource {
	// Use system default fonts as fallback.
	// For production, bundle Space Grotesk and JetBrains Mono as fyne.Resource.
	if style.Monospace {
		return theme.DefaultTheme().Font(style)
	}
	return theme.DefaultTheme().Font(style)
}

func (t *pomodoroTheme) Icon(name fyne.ThemeIconName) fyne.Resource {
	return theme.DefaultTheme().Icon(name)
}

func (t *pomodoroTheme) Size(name fyne.ThemeSizeName) float32 {
	switch name {
	case theme.SizeNamePadding:
		return 8
	case theme.SizeNameInnerPadding:
		return 12
	case theme.SizeNameText:
		return 14
	case theme.SizeNameHeadingText:
		return 24
	case theme.SizeNameSubHeadingText:
		return 18
	case theme.SizeNameInputBorder:
		return 0 // no borders per design
	case theme.SizeNameScrollBar:
		return 6
	case theme.SizeNameScrollBarSmall:
		return 3
	}
	return theme.DefaultTheme().Size(name)
}
