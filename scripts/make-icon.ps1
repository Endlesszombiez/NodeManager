# Generates the app's code-native Windows icon without an external image tool.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$images = @()
foreach ($size in @(16, 32, 48, 64, 128, 256)) {
    $bitmap = New-Object Drawing.Bitmap($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#1b2719'))
    $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#b5ed90'))
    $font = New-Object Drawing.Font('Segoe UI', ($size * 0.76), [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $graphics.DrawString('n', $font, $brush, ($size * 0.17), (-$size * 0.04))
    $dot = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#edf2ec'))
    $graphics.FillEllipse($dot, ($size * 0.71), ($size * 0.31), ($size * 0.13), ($size * 0.13))
    $stream = New-Object IO.MemoryStream
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $images += ,([pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() })
    $stream.Dispose(); $font.Dispose(); $brush.Dispose(); $dot.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$target = Join-Path $PSScriptRoot '..\installer\icon.ico'
$file = [IO.File]::Create($target)
$writer = New-Object IO.BinaryWriter($file)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($item in $images) {
        $dimension = if ($item.Size -eq 256) { 0 } else { $item.Size }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$item.Bytes.Length); $writer.Write([uint32]$offset)
        $offset += $item.Bytes.Length
    }
    foreach ($item in $images) { $writer.Write([byte[]]$item.Bytes) }
} finally { $writer.Dispose(); $file.Dispose() }
Write-Output "Created $target"
