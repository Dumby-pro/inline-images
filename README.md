# inline-images

A Claude Code mod that lets Claude show PNG images right inside the chat.

It adds a `show_image` tool. When Claude calls it with a path to a PNG, the image is drawn under the tool's row in the transcript, scaled to fit the window while keeping its aspect ratio, with an optional caption. Ask things like "show me ~/Pictures/foo.png" or "render that chart and show it to me".

## Requirements

- A terminal with inline graphics: kitty or Ghostty (kitty graphics protocol), or iTerm2 3.5+ in fullscreen rendering. Other terminals show a text placeholder instead.
- PNG files only. Claude is told to convert other formats to PNG first (for example with ImageMagick).

The terminal reads the file straight from disk, so large PNGs aren't copied through Claude Code. Claude does not see the image through this tool; it uses Read for that.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install inline-images --marketplace Dumby-pro/inline-images
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install inline-images --marketplace Dumby-pro/inline-images
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `Dumby-pro/inline-images`, then Add plugin.

## License

MIT
