# Deterministic WCAG AA verification for all 9 stories.
# Composites source-photo pixels with the engine's scrim gradients at each
# text band, then computes WCAG contrast for the actual rendered text colors.
# Rationale: the router stacks posts 02-09 below the 1080x1920 canvas, so
# `hyperframes check` only pixel-samples story-01. This closes the gap.

Add-Type -AssemblyName System.Drawing

$script:fail = 0

function Luminance([double]$r, [double]$g, [double]$b) {
  function Lin([double]$c) { $c = $c / 255.0; if ($c -le 0.04045) { return $c / 12.92 } else { return [Math]::Pow(($c + 0.055) / 1.055, 2.4) } }
  return 0.2126 * (Lin $r) + 0.7152 * (Lin $g) + 0.0722 * (Lin $b)
}
function Contrast($r1,$g1,$b1,$r2,$g2,$b2) {
  $L1 = Luminance $r1 $g1 $b1; $L2 = Luminance $r2 $g2 $b2
  if ($L1 -lt $L2) { $t=$L1; $L1=$L2; $L2=$t }
  return ($L1 + 0.05) / ($L2 + 0.05)
}
function RampAlpha([double]$pct, [double[]]$stops, [double[]]$alphas) {
  # piecewise-linear interpolation across gradient stops (pct 0..100)
  if ($pct -le $stops[0]) { return $alphas[0] }
  for ($i = 1; $i -lt $stops.Count; $i++) {
    if ($pct -le $stops[$i]) {
      $t = ($pct - $stops[$i-1]) / ($stops[$i] - $stops[$i-1])
      return $alphas[$i-1] + $t * ($alphas[$i] - $alphas[$i-1])
    }
  }
  return $alphas[$alphas.Count - 1]
}

# --- engine scrim constants (must mirror shared/story-system.css) ---
$topStops = @(0, 50, 75, 100)          # % of 380px top scrim
$topAlphaCharcoal = @(0.95, 0.92, 0.55, 0.0)
$topAlphaWarm     = @(0.96, 0.93, 0.58, 0.0)
$topColorCharcoal = @(0, 0, 0)
$topColorWarm     = @(15, 10, 5)

$botStops = @(0, 40, 60, 85, 100)      # % of 680px bottom scrim (0% = bottom edge)
$botAlphaCharcoal = @(0.97, 0.96, 0.70, 0.25, 0.0)
$botAlphaWarm     = @(0.97, 0.96, 0.72, 0.26, 0.0)
$botColorCharcoal = @(10, 10, 12)
$botColorWarm     = @(20, 14, 8)

# --- verified mapping (mission Part 2) ---
$map = @{
  1 = @{ theme='charcoal'; variant='bottom-left'  }
  2 = @{ theme='charcoal'; variant='bottom-left'  }
  3 = @{ theme='warm';     variant='centered'     }
  4 = @{ theme='warm';     variant='bottom-left'  }
  5 = @{ theme='warm';     variant='bottom-right' }
  6 = @{ theme='charcoal'; variant='bottom-left'  }
  7 = @{ theme='charcoal'; variant='bottom-left'  }
  8 = @{ theme='warm';     variant='bottom-left'  }
  9 = @{ theme='warm';     variant='bottom-right' }
}

# --- copy-block vertical layout (from engine: bottom:220px, flex, gap:12px) ---
# eyebrow 13px (~16px line) | gap 12 | h1 2 lines x 52px x 1.08 (~112px) | gap 12 | cta 12px (mt 8, ~15px)
$bandEyebrow = @(1522, 1543)
$bandH1      = @(1552, 1668)
$bandCta     = @(1673, 1700)
$brandY      = @(140, 180)   # .bar-top top:140px, logo 40px

# text colors (rendered)
$brandText   = @(255,255,255); $brandTau   = 0.9   # opacity .9
$eyebrowCount = @(245,242,235); $eyebrowTau = 0.9  # var(--bone,#f5f2eb) opacity .9
$h1Text      = @(255,255,255); $h1Tau      = 1.0
$ctaText     = @(198,167,125); $ctaTau     = 1.0   # var(--brass,#c6a77d)

$root = "D:\Projects\dk-pipeline"

foreach ($n in 1..9) {
  $cfg = $map[$n]
  $theme = $cfg.theme; $variant = $cfg.variant
  $bmp = [System.Drawing.Bitmap]::FromFile("$root\assets\raw\optimized\$n.jpg")
  $W = $bmp.Width; $H = $bmp.Height
  $scale = [Math]::Max(1080.0 / $W, 1920.0 / $H)
  $rw = $W * $scale; $offx = ($rw - 1080.0) / 2.0

  switch ($variant) {
    'bottom-left'  { $xs = 80;  $xe = 960  }
    'bottom-right' { $xs = 120; $xe = 1000 }
    'centered'     { $xs = 80;  $xe = 1000 }
  }

  if ($theme -eq 'charcoal') { $ta = $topAlphaCharcoal; $tc = $topColorCharcoal; $ba = $botAlphaCharcoal; $bc = $botColorCharcoal }
  else                        { $ta = $topAlphaWarm;     $tc = $topColorWarm;     $ba = $botAlphaWarm;     $bc = $botColorWarm }

  # gather (band, textcolor, tau, threshold, label)
  $bands = @(
    @{ y0=$brandY[0];      y1=$brandY[1];      col=$brandText;    tau=$brandTau;    need=4.5; label='brand 13px'  }
    @{ y0=$bandEyebrow[0]; y1=$bandEyebrow[1]; col=$eyebrowCount; tau=$eyebrowTau;  need=4.5; label='eyebrow 13px'}
    @{ y0=$bandH1[0];      y1=$bandH1[1];      col=$h1Text;       tau=$h1Tau;       need=3.0; label='h1 52px'     }
    @{ y0=$bandCta[0];     y1=$bandCta[1];     col=$ctaText;      tau=$ctaTau;      need=4.5; label='cta 12px'    }
  )

  Write-Output ("=== story-0{0}  theme={1}  variant={2}  photo={3}x{4} ===" -f $n, $theme, $variant, $W, $H)

  foreach ($band in $bands) {
    $ratios = New-Object System.Collections.Generic.List[double]
    $stepY = [Math]::Max(1, [int](($band.y1 - $band.y0) / 6))
    $stepX = 40
    for ($y = $band.y0; $y -le $band.y1; $y += $stepY) {
      # scrim alpha at this y
      if ($y -lt 380) {
        $pct = $y / 3.8
        $a = RampAlpha $pct $topStops $ta
        $sr = $tc[0]; $sg = $tc[1]; $sb = $tc[2]
      } elseif ($y -ge 1240) {
        $pct = (1920 - $y) / 6.8
        $a = RampAlpha $pct $botStops $ba
        $sr = $bc[0]; $sg = $bc[1]; $sb = $bc[2]
      } else { $a = 0; $sr=0; $sg=0; $sb=0 }

      for ($x = $xs; $x -le $xe; $x += $stepX) {
        $u = [int](($x + $offx) / $scale); $v = [int]($y / $scale)
        if ($u -ge $W) { $u = $W - 1 }; if ($v -ge $H) { $v = $H - 1 }
        if ($u -lt 0) { $u = 0 }; if ($v -lt 0) { $v = 0 }
        $p = $bmp.GetPixel($u, $v)
        # composite photo under scrim
        $br = $p.R * (1 - $a) + $sr * $a
        $bg = $p.G * (1 - $a) + $sg * $a
        $bb = $p.B * (1 - $a) + $sb * $a
        # composite semi-transparent text over backdrop -> effective text color
        $tr = $band.col[0] * $band.tau + $br * (1 - $band.tau)
        $tg = $band.col[1] * $band.tau + $bg * (1 - $band.tau)
        $tb = $band.col[2] * $band.tau + $bb * (1 - $band.tau)
        $ratios.Add((Contrast $tr $tg $tb $br $bg $bb))
      }
    }
    $sorted = $ratios | Sort-Object
    $p5  = $sorted[[int](0.05 * ($sorted.Count - 1))]
    $p50 = $sorted[[int](0.50 * ($sorted.Count - 1))]
    $min = $sorted[0]
    $okMin = $min -ge $band.need
    if (-not $okMin) { $script:fail++ }
    $flag = if ($okMin) { 'PASS' } else { 'FAIL' }
    Write-Output ("  {0,-13} need {1}: p50={2,6:N2}  p5={3,6:N2}  worst={4,6:N2}  [{5}]" -f $band.label, $band.need, $p50, $p5, $min, $flag)
  }
  $bmp.Dispose()
}

Write-Output ""
if ($script:fail -eq 0) { Write-Output "RESULT: all 9 stories clear WCAG AA at every text band (worst-case pixel)." }
else { Write-Output ("RESULT: {0} band(s) FAIL WCAG AA." -f $script:fail) }
