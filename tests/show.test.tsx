import { expect, test } from 'claude-code/testing'

const PNG = '/tmp/inline-images-test.png'
const HEADERS: Record<string, string> = {
    test: 'iVBORw0KGgoAAAANSUhEUgAAAZAAAADI',
    fake: 'bm90cG5nCg==',
}

function mockFs(on: any) {
    on('session.cwd', () => ({ value: '/tmp' }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 100, mtimeMs: 1, isLink: false } }))
    on('fs.read', (_: unknown, e: { path: string }) => ({
        value: { base64: e.path.endsWith('fake.png') ? HEADERS.fake : HEADERS.test },
    }))
}

const TOOL = 'mcp__inline-images__show_image'

test('reads PNG size and draws an Image under the row', async ($, on) => {
    mockFs(on)
    const ran = await $.tool.call({ tool: TOOL, path: PNG, caption: 'hi' } as never)
    expect(JSON.parse((ran as { result: string }).result)).toMatchObject({ width: 400, height: 200, path: PNG })

    const ui = await $.ui.mount({
        plugin: 'inline-images',
        surface: 'terminal',
        component: 'ToolUse',
        props: { tool_use_id: 't1', tool: TOOL, input: { path: PNG }, isRunning: false, isErrored: false, isInterrupted: false, output: (ran as { result: unknown }).result },
    } as never)

    const img = await ui.find({ type: 'Image' } as never)
    expect(img).toBeDefined()
    expect(JSON.stringify(img)).toContain('"columns":45')
    await ui.unmount()
})

test('refuses a file that is not a PNG', async ($, on) => {
    mockFs(on)
    const ran = await $.tool.call({ tool: TOOL, path: '/tmp/fake.png' } as never)
    expect(JSON.stringify(ran)).toContain('not a PNG')
})
