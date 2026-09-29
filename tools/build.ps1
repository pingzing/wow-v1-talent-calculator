# Reads data/*.json and tools/index.template.html, emits index.html with all classes' tree
# sections, cell shells, tooltip templates, and SVG prereq arrows baked in.
# Run this after any change to data/*.json.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$classes = @('druid', 'hunter', 'mage', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior')

# Grid geometry must match --cell and --gap in styles.css.
$CELL = 56
$GAP = 14
$STRIDE = $CELL + $GAP    # centre-to-centre distance = 70
$COLS = 4
$ROWS = 7
$CENTER_COLS = @(1, 2, 0, 3)  # preference when auto-placing a null-column talent
$INSET = 6                # arrowhead gap before target edge

function Encode-Html {
    param([string]$s)
    if ($null -eq $s) { return '' }
    return ($s -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;' -replace '"', '&quot;' -replace "'", '&#39;')
}

function Encode-Attr {
    param([string]$s)
    return (Encode-Html $s)
}

function Get-Placements {
    param($classData)
    $out = @{}
    foreach ($treeName in $classData.trees) {
        $tierMap = @{}
        for ($tier = 1; $tier -le $ROWS; $tier++) { $tierMap[$tier] = New-Object System.Collections.Generic.HashSet[int] }

        $talents = @($classData.talents | Where-Object { $_.tree -eq $treeName })
        $resolved = @()
        $deferred = @()
        foreach ($t in $talents) {
            if ($null -eq $t.column) {
                $deferred += $t
            }
            else {
                [void]$tierMap[[int]$t.tier].Add([int]$t.column)
                $resolved += [pscustomobject]@{ Talent = $t; Row = [int]$t.tier; Col = [int]$t.column; Unverified = $false }
            }
        }
        foreach ($t in $deferred) {
            $col = $null
            foreach ($c in $CENTER_COLS) {
                if (-not $tierMap[[int]$t.tier].Contains($c)) { $col = $c; break }
            }
            if ($null -eq $col) {
                for ($c = 0; $c -lt $COLS; $c++) {
                    if (-not $tierMap[[int]$t.tier].Contains($c)) { $col = $c; break }
                }
            }
            if ($null -eq $col) { $col = 1 }
            [void]$tierMap[[int]$t.tier].Add($col)
            $resolved += [pscustomobject]@{ Talent = $t; Row = [int]$t.tier; Col = $col; Unverified = $true }
        }
        $out[$treeName] = $resolved
    }
    return $out
}

function Get-CellRect {
    param([int]$Col, [int]$Row)
    # Row is 1-indexed (matches tier), Col is 0-indexed.
    $left = $Col * $STRIDE
    $top = ($Row - 1) * $STRIDE
    return [pscustomobject]@{
        Left   = $left
        Top    = $top
        Right  = $left + $CELL
        Bottom = $top + $CELL
        Cx     = $left + [math]::Floor($CELL / 2)
        Cy     = $top + [math]::Floor($CELL / 2)
    }
}

# Mirrors the JS orthogonal router: same-col vertical, same-row horizontal, otherwise
# leave prereq on its horizontal edge, corner at target column, enter target vertically.
function Get-ArrowPath {
    param($From, $To)

    $dx = $To.Cx - $From.Cx
    $dy = $To.Cy - $From.Cy
    $sameCol = [math]::Abs($dx) -lt 2
    $sameRow = [math]::Abs($dy) -lt 2

    $startX = 0; $startY = 0; $endX = 0; $endY = 0; $cornerX = $null; $cornerY = $null; $dir = 'down'

    if ($sameCol) {
        $startX = $From.Cx
        $endX = $To.Cx
        if ($dy -ge 0) {
            $startY = $From.Bottom
            $endY = $To.Top - $INSET
            $dir = 'down'
        }
        else {
            $startY = $From.Top
            $endY = $To.Bottom + $INSET
            $dir = 'up'
        }
    }
    elseif ($sameRow) {
        $startY = $From.Cy
        $endY = $To.Cy
        if ($dx -gt 0) {
            $startX = $From.Right
            $endX = $To.Left - $INSET
            $dir = 'right'
        }
        else {
            $startX = $From.Left
            $endX = $To.Right + $INSET
            $dir = 'left'
        }
    }
    else {
        $startY = $From.Cy
        if ($dx -gt 0) { $startX = $From.Right } else { $startX = $From.Left }
        $cornerX = $To.Cx
        $cornerY = $From.Cy
        $endX = $To.Cx
        if ($dy -gt 0) {
            $endY = $To.Top - $INSET
            $dir = 'down'
        }
        else {
            $endY = $To.Bottom + $INSET
            $dir = 'up'
        }
    }

    if ($null -eq $cornerX) {
        $d = "M $startX $startY L $endX $endY"
    }
    else {
        $d = "M $startX $startY L $cornerX $cornerY L $endX $endY"
    }

    # Arrowhead triangle in the appropriate direction.
    $s = 5; $l = 6
    switch ($dir) {
        'down' { $head = "M $($endX - $s) $endY L $($endX + $s) $endY L $endX $($endY + $l) Z" }
        'up' { $head = "M $($endX - $s) $endY L $($endX + $s) $endY L $endX $($endY - $l) Z" }
        'right' { $head = "M $endX $($endY - $s) L $endX $($endY + $s) L $($endX + $l) $endY Z" }
        'left' { $head = "M $endX $($endY - $s) L $endX $($endY + $s) L $($endX - $l) $endY Z" }
    }

    return [pscustomobject]@{ LinePath = $d; HeadPath = $head }
}

function Classify-CastNote {
    param([string]$note)
    if ($note -match '^\d+\s+(Mana|Rage|Energy|Focus)$') { return 'resource' }
    if ($note -match 'cooldown\s*$') { return 'cooldown' }
    if ($note -match 'yard range\s*$') { return 'range' }
    if ($note -match '^(Instant|Instant cast|Next melee)$') { return 'cast' }
    if ($note -match 'second\s+cast\s*$') { return 'cast' }
    if ($note -match '^Requires\b') { return 'req' }
    return 'other'
}

function Render-CastNotes {
    param($notes)
    if (-not $notes -or $notes.Count -eq 0) { return '' }
    $buckets = @{ resource = @(); cast = @(); cooldown = @(); range = @(); req = @(); other = @() }
    foreach ($n in $notes) { $buckets[(Classify-CastNote $n)] += $n }

    $rows = @()
    $addSplit = {
        param($left, $right)
        if ($left.Count -eq 0 -and $right.Count -eq 0) { return }
        $l = if ($left.Count) { Encode-Html ($left -join ', ') } else { '' }
        $r = if ($right.Count) { Encode-Html ($right -join ', ') } else { '' }
        $script:_row = "<div class=`"tt-line`"><span>$l</span><span class=`"r`">$r</span></div>"
        $script:_rows += $script:_row
    }
    $script:_rows = @()
    & $addSplit $buckets.resource $buckets.range
    & $addSplit $buckets.cast $buckets.cooldown
    foreach ($r in $buckets.req) { $script:_rows += "<div>$(Encode-Html $r)</div>" }
    foreach ($o in $buckets.other) { $script:_rows += "<div>$(Encode-Html $o)</div>" }

    if ($script:_rows.Count -eq 0) { return '' }
    return "<div class=`"tt-cast`">$($script:_rows -join '')</div>"
}

function Render-Tooltip {
    param($talent)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("<div class=`"tt-name`">$(Encode-Html $talent.name)</div>")

    $cast = Render-CastNotes $talent.cast.notes
    if ($cast) { [void]$sb.Append($cast) }

    [void]$sb.Append('<div class="tt-ranks">')
    for ($i = 0; $i -lt $talent.ranks.Count; $i++) {
        $rank = $i + 1
        $desc = Encode-Html $talent.ranks[$i].description
        [void]$sb.Append("<div class=`"tt-rank`" data-rank=`"$rank`" hidden><div class=`"tt-rank-label`">Rank $rank</div><div class=`"tt-desc`">$desc</div></div>")
    }
    [void]$sb.Append('</div>')

    $reqs = @()
    if ($talent.treePointsRequired -gt 0) {
        $reqs += "<div class=`"tt-req`" data-req-tree=`"$(Encode-Attr $talent.tree)`" data-req-points=`"$($talent.treePointsRequired)`">Requires $($talent.treePointsRequired) pts in $(Encode-Html $talent.tree)</div>"
    }
    foreach ($p in $talent.prereqs) {
        $ptWord = if ($p.points -eq 1) { 'pt' } else { 'pts' }
        $reqs += "<div class=`"tt-req`" data-req-talent=`"$(Encode-Attr $p.name)`" data-req-points=`"$($p.points)`">Requires $($p.points) $ptWord in $(Encode-Html $p.name)</div>"
    }
    if ($reqs.Count -gt 0) {
        [void]$sb.Append('<div class="tt-reqs">')
        foreach ($r in $reqs) { [void]$sb.Append($r) }
        [void]$sb.Append('</div>')
    }

    return $sb.ToString()
}

function Render-Cell {
    param($placement)
    $t = $placement.Talent

    # PS 5.1's ConvertTo-Json unwraps 1-element arrays into scalars; build the JSON by hand.
    $prereqItems = @()
    foreach ($p in @($t.prereqs)) {
        if ($null -ne $p) { $prereqItems += ($p | ConvertTo-Json -Compress) }
    }
    $prereqsJson = '[' + ($prereqItems -join ',') + ']'
    # Attribute is single-quoted so double quotes pass through, but apostrophes in
    # talent names (e.g. "Nature's Grasp") would close the attribute early.
    $prereqsJson = Encode-Attr $prereqsJson

    $unverifiedBadge = if ($placement.Unverified) { '<span class="unverified-badge" title="Position not verified against modern Wowhead calc.">?</span>' } else { '' }

    $tooltip = Render-Tooltip $t

    $gridCol = $placement.Col + 1

    $lines = @(
        "<div class=`"talent`" data-name=`"$(Encode-Attr $t.name)`" data-tree=`"$(Encode-Attr $t.tree)`" data-tier=`"$($t.tier)`" data-max-ranks=`"$($t.maxRanks)`" data-tree-req=`"$($t.treePointsRequired)`" data-prereqs='$prereqsJson' style=`"grid-column:$gridCol;grid-row:$($placement.Row)`">"
        "  <img src=`"$(Encode-Attr $t.icon)`" alt=`"$(Encode-Attr $t.name)`" draggable=`"false`">"
        "  <span class=`"rank-badge`">0/$($t.maxRanks)</span>"
        $unverifiedBadge
        "  <template class=`"tt`">$tooltip</template>"
        "</div>"
    )
    return ($lines -join "`n")
}

function Render-Arrows {
    param($placements)

    $byName = @{}
    foreach ($p in $placements) { $byName[$p.Talent.name] = $p }

    $svgWidth = $COLS * $STRIDE - $GAP
    $svgHeight = $ROWS * $STRIDE - $GAP

    $edges = @()
    foreach ($p in $placements) {
        foreach ($pr in $p.Talent.prereqs) {
            $fromP = $byName[$pr.name]
            if (-not $fromP) { continue }
            $fromR = Get-CellRect -Col $fromP.Col -Row $fromP.Row
            $toR = Get-CellRect -Col $p.Col -Row $p.Row
            $ar = Get-ArrowPath $fromR $toR
            $edges += [pscustomobject]@{
                FromName       = $pr.name
                ToName         = $p.Talent.name
                RequiredPoints = $pr.points
                LinePath       = $ar.LinePath
                HeadPath       = $ar.HeadPath
            }
        }
    }

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("<svg class=`"arrows`" width=`"$svgWidth`" height=`"$svgHeight`" viewBox=`"0 0 $svgWidth $svgHeight`" preserveAspectRatio=`"none`">")
    foreach ($e in $edges) {
        [void]$sb.Append("<g class=`"arrow`" data-from=`"$(Encode-Attr $e.FromName)`" data-to=`"$(Encode-Attr $e.ToName)`" data-req-points=`"$($e.RequiredPoints)`">")
        [void]$sb.Append("<path class=`"arrow-line`" d=`"$($e.LinePath)`" fill=`"none`" />")
        [void]$sb.Append("<path class=`"arrow-head`" d=`"$($e.HeadPath)`" stroke=`"none`" />")
        [void]$sb.Append('</g>')
    }
    [void]$sb.Append('</svg>')
    return $sb.ToString()
}

function Render-Class {
    param([string]$className, $classData)

    $placements = Get-Placements $classData

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("<section class=`"tree-set`" data-class=`"$className`">")

    foreach ($treeName in $classData.trees) {
        $treePlacements = $placements[$treeName]
        [void]$sb.AppendLine("  <section class=`"tree`" data-tree=`"$(Encode-Attr $treeName)`">")
        [void]$sb.AppendLine("    <header class=`"tree-header`">")
        [void]$sb.AppendLine("      <h2>$(Encode-Html $treeName)</h2>")
        [void]$sb.AppendLine("      <span class=`"tree-points`" data-tree-points=`"$(Encode-Attr $treeName)`">0</span>")
        [void]$sb.AppendLine("      <button type=`"button`" class=`"btn reset-tree`" data-tree=`"$(Encode-Attr $treeName)`">Reset</button>")
        [void]$sb.AppendLine('    </header>')
        [void]$sb.AppendLine('    <div class="tree-grid">')
        [void]$sb.AppendLine((Render-Arrows $treePlacements))
        foreach ($p in $treePlacements) {
            [void]$sb.AppendLine((Render-Cell $p))
        }
        [void]$sb.AppendLine('    </div>')
        [void]$sb.AppendLine('  </section>')
    }

    [void]$sb.AppendLine('</section>')
    return $sb.ToString()
}

$sections = New-Object System.Text.StringBuilder
foreach ($className in $classes) {
    $path = "data\$className.json"
    Write-Host "Building $className..."
    $j = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    [void]$sections.Append((Render-Class $className $j))
}

$template = Get-Content -Raw -LiteralPath 'tools\index.template.html'
$html = $template -replace '<!-- @classes -->', $sections.ToString()

Set-Content -LiteralPath 'index.html' -Value $html -Encoding UTF8
$size = (Get-Item 'index.html').Length
Write-Host "Wrote index.html ($([math]::Round($size / 1KB, 1)) KB)"
