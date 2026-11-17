import type { Register } from 'claude-code'

//

const TOOL_NAME = 'show_image'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// Typical terminal cell is about twice as tall as it is wide, ~9px across
const CELL_ASPECT = 0.5
const PX_PER_COLUMN = 9
const MAX_CELLS = 255

//

type Shown = {
    path: string
    width: number
    height: number
    generation: number
    caption?: string
    columns?: number
}

type Input = { path?: unknown; caption?: unknown; columns?: unknown }

//

function joinPath(cwd: string, path: string): string {
    if (path.startsWith('/')) return path

    const parts = cwd.split('/')
    for (const part of path.split('/')) {
        if (part === '' || part === '.') continue
        if (part === '..') parts.pop()
        else parts.push(part)
    }

    return parts.join('/') || '/'
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function decodeBase64(text: string): Uint8Array {
    const clean = text.replace(/=+$/, '')
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4))
    let bits = 0, acc = 0, n = 0

    for (const ch of clean) {
        acc = (acc << 6) | B64.indexOf(ch)
        bits += 6
        if (bits >= 8) {
            bits -= 8
            out[n++] = (acc >> bits) & 0xff
        }
    }

    return out
}

function readPngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
    if (bytes.length < 24) return undefined
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) return undefined
    }

    // IHDR chunk always comes first: width/height are big-endian u32 at 16 and 20
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)

    if (width === 0 || height === 0) return undefined
    return { width, height }
}

// Fit the picture into the cells available while keeping its aspect ratio
function fitCells(shown: Shown, maxColumns: number, maxRows: number) {
    const ratio = shown.height / shown.width

    let columns = Math.min(
        shown.columns ?? Math.ceil(shown.width / PX_PER_COLUMN),
        maxColumns,
        MAX_CELLS,
    )
    let rows = Math.round(columns * ratio * CELL_ASPECT)

    if (rows > maxRows) {
        rows = maxRows
        columns = Math.round(rows / (ratio * CELL_ASPECT))
    }

    return { columns: Math.max(1, columns), rows: Math.max(1, Math.min(rows, MAX_CELLS)) }
}

function parseShown(value: unknown): Shown | undefined {
    if (typeof value !== 'string') return undefined

    let v: Shown | undefined
    try {
        v = JSON.parse(value) as Shown
    } catch {
        return undefined
    }

    return isShown(v) ? v : undefined
}

function isShown(value: unknown): value is Shown {
    const v = value as Shown | undefined
    return typeof v === 'object' && v !== null
        && typeof v.path === 'string'
        && typeof v.width === 'number'
        && typeof v.height === 'number'
}

//

export const register: Register = on => {
    const fullName = (plugin: string) => `mcp__${plugin}__${TOOL_NAME}`

    on('session.start', async ($, e, next) => {
        await $.tool.register({
            name: TOOL_NAME,
            isDeferred: false,
            description:
                'Display a PNG image inline in the user\'s chat window so they can see it. '
                + 'Use whenever the user asks to see/show/preview an image, or when showing a '
                + 'generated chart, screenshot or render would help. Only PNG is supported; '
                + 'convert other formats to PNG first (e.g. `magick in.jpg /tmp/out.png`). '
                + 'You do not see the image through this tool; use Read for that.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to the PNG file (absolute or relative to the working directory)' },
                    caption: { type: 'string', description: 'Optional short caption shown under the image' },
                    columns: { type: 'integer', minimum: 4, maximum: 255, description: 'Optional width in terminal columns; defaults to the image\'s natural size, capped to the window' },
                },
                required: ['path'],
                additionalProperties: false,
            },
        })

        return next(e)
    })

    //

    on('tool.run', ($, e, next) => {
        if (e.tool !== fullName($.plugin.name)) return next(e)

        return (async () => {
            const input = e as unknown as Input
            if (typeof input.path !== 'string' || input.path.trim() === '') {
                return { deny: 'path is required' }
            }

            let raw = input.path.trim()
            if (raw.startsWith('~/')) {
                const home = await $.env.get('HOME')
                if (!home) return { deny: 'Cannot expand ~ here; pass an absolute path.' }
                raw = home + raw.slice(1)
            }

            const path = joinPath(await $.session.cwd(), raw)

            let stat
            try {
                stat = await $.fs.stat(path)
            } catch {
                return { deny: `No such file: ${path}` }
            }
            if (stat.kind !== 'file') return { deny: `Not a regular file: ${path}` }

            const realPath = stat.realPath ?? path
            const { base64 } = await $.fs.read(realPath, { as: 'bytes', length: 24 })
            const size = readPngSize(decodeBase64(base64))
            if (!size) {
                return { deny: `${path} is not a PNG. Convert it to PNG first, then call ${TOOL_NAME} again.` }
            }

            const shown: Shown = {
                path: realPath,
                width: size.width,
                height: size.height,
                generation: Math.floor(stat.mtimeMs),
                caption: typeof input.caption === 'string' ? input.caption.slice(0, 500) : undefined,
                columns: typeof input.columns === 'number' ? Math.floor(input.columns) : undefined,
            }

            return {
                result: JSON.stringify(shown),
                context: [`Displayed ${realPath} (${size.width}x${size.height}) to the user.`],
            }
        })()
    })

    //

    on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
        const row = await next(e)
        if (e.surface !== 'terminal' || e.props.tool !== fullName($.plugin.name)) return row

        if (e.props.isRunning || e.props.isErrored) return row

        const output = parseShown(e.props.output)
        if (!output) return row

        const { Box, Text, Image } = $.ui.resolve(e)
        const maxColumns = Math.max(4, (e.viewport?.columns ?? 80) - 6)
        const maxRows = Math.max(4, Math.floor((e.viewport?.rows ?? 40) * 0.75))
        const { columns, rows } = fitCells(output, maxColumns, maxRows)

        return (
            <Box flexDirection="column">
                {row}
                <Box flexDirection="column" paddingLeft={2} marginTop={1}>
                    <Image
                        source={{ file: output.path, format: 'png', generation: output.generation }}
                        columns={columns}
                        rows={rows}
                        alt={`[image: ${output.path} — this terminal can't draw images]`}
                    />
                    {output.caption ? <Text dimColor>{output.caption}</Text> : null}
                </Box>
            </Box>
        )
    })
}
