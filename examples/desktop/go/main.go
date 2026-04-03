package main

import (
	"context"
	"fmt"
	"image/color"
	"math"
	"os"
	"os/signal"
	"syscall"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/widget"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

func main() {
	timer := NewPomodoroTimer()
	if err := timer.Load(); err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not load data: %v\n", err)
	}

	server := setupProvider(timer)

	sockPath := os.Getenv("POMODORO_SOCK")
	if sockPath == "" {
		sockPath = "/tmp/slop/pomodoro.sock"
	}

	// Start SLOP socket in background
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		if err := slop.ListenUnix(ctx, server, sockPath); err != nil {
			fmt.Fprintf(os.Stderr, "slop: %v\n", err)
		}
	}()

	// Write discovery
	writeDiscovery(timer, sockPath)

	// Handle signals
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigs
		removeDiscovery()
		cancel()
		os.Exit(0)
	}()

	// --- Fyne app ---
	a := app.New()
	a.Settings().SetTheme(&pomodoroTheme{})
	w := a.NewWindow("Pomodoro")
	w.Resize(fyne.NewSize(420, 640))

	// --- UI elements ---

	// Title
	titleLabel := canvas.NewText("POMODORO", colorPrimary)
	titleLabel.TextSize = 18
	titleLabel.TextStyle = fyne.TextStyle{Bold: true}

	// Working on label
	workingOnLabel := canvas.NewText("", colorSecondary)
	workingOnLabel.TextSize = 13
	workingOnLabel.Alignment = fyne.TextAlignCenter

	tagLabel := canvas.NewText("", colorForeground)
	tagLabel.TextSize = 16
	tagLabel.TextStyle = fyne.TextStyle{Bold: true}
	tagLabel.Alignment = fyne.TextAlignCenter

	// Timer countdown
	countdownLabel := canvas.NewText("0:00", colorForeground)
	countdownLabel.TextSize = 56
	countdownLabel.TextStyle = fyne.TextStyle{Monospace: true, Bold: true}
	countdownLabel.Alignment = fyne.TextAlignCenter

	// Phase label
	phaseLabel := canvas.NewText("IDLE", colorSecondary)
	phaseLabel.TextSize = 12
	phaseLabel.TextStyle = fyne.TextStyle{Monospace: true}
	phaseLabel.Alignment = fyne.TextAlignCenter

	// Progress arc (custom drawn)
	arcWidget := newTimerArc()

	// Buttons
	startBtn := widget.NewButton("START", nil)
	pauseBtn := widget.NewButton("PAUSE", nil)
	resumeBtn := widget.NewButton("RESUME", nil)
	skipBtn := widget.NewButton("SKIP", nil)
	stopBtn := widget.NewButton("STOP", nil)

	// Tag entry for start
	tagEntry := widget.NewEntry()
	tagEntry.SetPlaceHolder("What are you working on?")

	// Tag input + start button row
	tagEntry.SetMinRowsVisible(1)
	startRow := container.NewBorder(nil, nil, nil, startBtn, tagEntry)

	// Button container (will be rebuilt based on state)
	buttonBox := container.NewHBox()

	// Session list
	sessionListLabel := canvas.NewText("TODAY: 0 POMODOROS", colorSecondary)
	sessionListLabel.TextSize = 12
	sessionListLabel.TextStyle = fyne.TextStyle{Monospace: true}

	sessionList := container.NewVBox()

	// Stats
	statsLabel := canvas.NewText("", colorForegroundDim)
	statsLabel.TextSize = 11
	statsLabel.TextStyle = fyne.TextStyle{Monospace: true}
	statsLabel.Alignment = fyne.TextAlignCenter

	// --- Update UI function ---
	updateUI := func() {
		timer.mu.Lock()
		phase := timer.Phase
		paused := timer.Paused
		remaining := timer.TimeRemaining
		elapsed := timer.TimeElapsed
		tag := timer.CurrentTag
		todayCount := timer.TodayCount()
		todayFocus := timer.TodayFocusMin()
		streakDays := timer.StreakDays()
		sessions := make([]Session, len(timer.Sessions))
		copy(sessions, timer.Sessions)
		settings := timer.Settings
		timer.mu.Unlock()

		// Countdown
		countdownLabel.Text = formatTime(remaining)
		countdownLabel.Refresh()

		// Phase text
		switch phase {
		case PhaseIdle:
			phaseLabel.Text = "IDLE"
			phaseLabel.Color = colorSecondary
		case PhaseWorking:
			if paused {
				phaseLabel.Text = "PAUSED"
				phaseLabel.Color = color.NRGBA{R: 0xFF, G: 0xC1, B: 0x07, A: 0xFF}
			} else {
				phaseLabel.Text = "WORKING"
				phaseLabel.Color = colorPrimary
			}
		case PhaseShortBreak:
			phaseLabel.Text = "SHORT BREAK"
			phaseLabel.Color = colorSecondary
		case PhaseLongBreak:
			phaseLabel.Text = "LONG BREAK"
			phaseLabel.Color = colorSecondary
		}
		phaseLabel.Refresh()

		// Working on
		if phase == PhaseWorking && tag != "" {
			workingOnLabel.Text = "WORKING ON:"
			tagLabel.Text = fmt.Sprintf("\"%s\"", tag)
		} else if phase == PhaseShortBreak || phase == PhaseLongBreak {
			workingOnLabel.Text = "TAKE A BREAK"
			tagLabel.Text = ""
		} else {
			workingOnLabel.Text = ""
			tagLabel.Text = ""
		}
		workingOnLabel.Refresh()
		tagLabel.Refresh()

		// Arc progress
		var totalDuration int
		switch phase {
		case PhaseWorking:
			totalDuration = settings.WorkDurationSec
		case PhaseShortBreak:
			totalDuration = settings.ShortBreakSec
		case PhaseLongBreak:
			totalDuration = settings.LongBreakSec
		default:
			totalDuration = 1
		}
		if phase == PhaseIdle {
			arcWidget.SetProgress(0)
		} else {
			progress := float64(elapsed) / float64(totalDuration)
			if progress > 1 {
				progress = 1
			}
			arcWidget.SetProgress(progress)
		}
		if phase == PhaseWorking {
			arcWidget.SetColor(colorPrimary)
		} else if phase == PhaseShortBreak || phase == PhaseLongBreak {
			arcWidget.SetColor(colorSecondary)
		} else {
			arcWidget.SetColor(colorForegroundDim)
		}

		// Buttons
		buttonBox.RemoveAll()
		switch {
		case phase == PhaseIdle:
			// Start is handled by startRow
		case phase == PhaseWorking && !paused:
			buttonBox.Add(layout.NewSpacer())
			buttonBox.Add(pauseBtn)
			buttonBox.Add(skipBtn)
			buttonBox.Add(stopBtn)
			buttonBox.Add(layout.NewSpacer())
		case paused:
			buttonBox.Add(layout.NewSpacer())
			buttonBox.Add(resumeBtn)
			buttonBox.Add(stopBtn)
			buttonBox.Add(layout.NewSpacer())
		case phase == PhaseShortBreak || phase == PhaseLongBreak:
			buttonBox.Add(layout.NewSpacer())
			buttonBox.Add(skipBtn)
			buttonBox.Add(stopBtn)
			buttonBox.Add(layout.NewSpacer())
		}
		buttonBox.Refresh()

		// Tag entry + start row visibility
		if phase == PhaseIdle {
			startRow.Show()
			buttonBox.Hide()
		} else {
			startRow.Hide()
			buttonBox.Show()
		}

		// Session list
		sessionListLabel.Text = fmt.Sprintf("TODAY: %d POMODOROS", todayCount)
		sessionListLabel.Refresh()

		sessionList.RemoveAll()
		// Show most recent completed sessions first
		for i := len(sessions) - 1; i >= 0; i-- {
			s := sessions[i]
			if !s.Completed {
				continue
			}
			startTime := ""
			if t, err := time.Parse(time.RFC3339, s.StartedAt); err == nil {
				startTime = t.Local().Format("3:04 PM")
			}
			durMin := s.DurationSec / 60
			line := fmt.Sprintf("%-9s %-20s #%-10s %dm", startTime, s.Tag, s.Category, durMin)

			lineText := canvas.NewText(line, colorForeground)
			lineText.TextSize = 12
			lineText.TextStyle = fyne.TextStyle{Monospace: true}

			card := canvas.NewRectangle(colorSurfaceContainer)
			card.CornerRadius = 4
			card.SetMinSize(fyne.NewSize(380, 32))

			sessionCard := container.NewStack(card, container.NewPadded(lineText))
			sessionList.Add(sessionCard)
		}
		sessionList.Refresh()

		// Stats
		statsLabel.Text = fmt.Sprintf("%d pomodoros today (%d min focus) | %d-day streak", todayCount, todayFocus, streakDays)
		statsLabel.Refresh()
	}

	// --- Button handlers ---
	startBtn.OnTapped = func() {
		tag := tagEntry.Text
		timer.mu.Lock()
		timer.Start(tag)
		_ = timer.Save()
		timer.mu.Unlock()
		server.Refresh()
		updateDiscovery(timer, sockPath)
		updateUI()
	}

	pauseBtn.OnTapped = func() {
		timer.mu.Lock()
		timer.Pause()
		timer.mu.Unlock()
		server.Refresh()
		updateDiscovery(timer, sockPath)
		updateUI()
	}

	resumeBtn.OnTapped = func() {
		timer.mu.Lock()
		timer.Resume()
		timer.mu.Unlock()
		server.Refresh()
		updateDiscovery(timer, sockPath)
		updateUI()
	}

	skipBtn.OnTapped = func() {
		timer.mu.Lock()
		timer.Skip()
		_ = timer.Save()
		timer.mu.Unlock()
		server.Refresh()
		updateDiscovery(timer, sockPath)
		updateUI()
	}

	stopBtn.OnTapped = func() {
		timer.mu.Lock()
		timer.Stop()
		_ = timer.Save()
		timer.mu.Unlock()
		server.Refresh()
		updateDiscovery(timer, sockPath)
		updateUI()
	}

	// --- Layout ---
	timerSection := container.NewVBox(
		container.NewCenter(workingOnLabel),
		container.NewCenter(tagLabel),
		container.NewCenter(
			container.NewStack(
				container.NewCenter(arcWidget),
				container.NewCenter(container.NewVBox(
					layout.NewSpacer(),
					container.NewCenter(countdownLabel),
					container.NewCenter(phaseLabel),
					layout.NewSpacer(),
				)),
			),
		),
	)

	separator := canvas.NewRectangle(colorSurfaceContainer)
	separator.SetMinSize(fyne.NewSize(0, 1))

	content := container.NewVBox(
		container.NewPadded(container.NewHBox(titleLabel, layout.NewSpacer())),
		timerSection,
		container.NewPadded(startRow),
		container.NewCenter(buttonBox),
		container.NewPadded(separator),
		container.NewPadded(sessionListLabel),
		container.NewPadded(sessionList),
		layout.NewSpacer(),
		container.NewPadded(container.NewCenter(statsLabel)),
	)

	w.SetContent(content)

	// Initial UI draw
	updateUI()

	// --- Timer tick goroutine ---
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				timer.mu.Lock()
				if timer.Phase != PhaseIdle && !timer.Paused {
					transitioned := timer.Tick()
					if transitioned {
						_ = timer.Save()
					}
				}
				timer.mu.Unlock()
				server.Refresh()
				updateDiscovery(timer, sockPath)
				// Update UI on main thread
				w.Canvas().Content().Refresh()
				updateUI()
			case <-ctx.Done():
				return
			}
		}
	}()

	w.SetOnClosed(func() {
		removeDiscovery()
		cancel()
	})

	fmt.Printf("pomodoro: listening on %s\n", sockPath)
	fmt.Printf("pomodoro: SLOP provider ready\n")

	w.ShowAndRun()
}

// --- Custom Timer Arc Widget ---

type timerArc struct {
	widget.BaseWidget
	progress float64
	arcColor color.Color
}

func newTimerArc() *timerArc {
	t := &timerArc{
		progress: 0,
		arcColor: colorForegroundDim,
	}
	t.ExtendBaseWidget(t)
	return t
}

func (t *timerArc) SetProgress(p float64) {
	t.progress = p
	t.Refresh()
}

func (t *timerArc) SetColor(c color.Color) {
	t.arcColor = c
	t.Refresh()
}

func (t *timerArc) MinSize() fyne.Size {
	return fyne.NewSize(200, 200)
}

func (t *timerArc) CreateRenderer() fyne.WidgetRenderer {
	return &timerArcRenderer{arc: t}
}

type timerArcRenderer struct {
	arc     *timerArc
	objects []fyne.CanvasObject
}

func (r *timerArcRenderer) Layout(size fyne.Size) {
	// Redraw on layout
}

func (r *timerArcRenderer) MinSize() fyne.Size {
	return r.arc.MinSize()
}

func (r *timerArcRenderer) Refresh() {
	r.updateObjects()
}

func (r *timerArcRenderer) Objects() []fyne.CanvasObject {
	return r.objects
}

func (r *timerArcRenderer) Destroy() {}

func (r *timerArcRenderer) updateObjects() {
	r.objects = nil

	size := r.arc.Size()
	cx := size.Width / 2
	cy := size.Height / 2
	radius := float64(min(size.Width, size.Height)/2 - 8)

	// Background circle (dim track)
	bgColor := color.NRGBA{R: 0x2A, G: 0x2E, B: 0x3A, A: 0xFF}
	segments := 60
	for i := 0; i < segments; i++ {
		angle1 := float64(i) / float64(segments) * 2 * math.Pi
		angle2 := float64(i+1) / float64(segments) * 2 * math.Pi

		x1 := float32(float64(cx) + radius*math.Sin(angle1))
		y1 := float32(float64(cy) - radius*math.Cos(angle1))
		x2 := float32(float64(cx) + radius*math.Sin(angle2))
		y2 := float32(float64(cy) - radius*math.Cos(angle2))

		line := canvas.NewLine(bgColor)
		line.StrokeWidth = 4
		line.Position1 = fyne.NewPos(x1, y1)
		line.Position2 = fyne.NewPos(x2, y2)
		r.objects = append(r.objects, line)
	}

	// Progress arc
	if r.arc.progress > 0 {
		progressSegments := int(float64(segments) * r.arc.progress)
		if progressSegments > segments {
			progressSegments = segments
		}
		for i := 0; i < progressSegments; i++ {
			angle1 := float64(i) / float64(segments) * 2 * math.Pi
			angle2 := float64(i+1) / float64(segments) * 2 * math.Pi

			x1 := float32(float64(cx) + radius*math.Sin(angle1))
			y1 := float32(float64(cy) - radius*math.Cos(angle1))
			x2 := float32(float64(cx) + radius*math.Sin(angle2))
			y2 := float32(float64(cy) - radius*math.Cos(angle2))

			line := canvas.NewLine(r.arc.arcColor)
			line.StrokeWidth = 4
			line.Position1 = fyne.NewPos(x1, y1)
			line.Position2 = fyne.NewPos(x2, y2)
			r.objects = append(r.objects, line)
		}
	}
}

func min(a, b float32) float32 {
	if a < b {
		return a
	}
	return b
}
