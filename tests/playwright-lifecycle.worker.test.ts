import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlaywrightPage, setBrowserBinding } from '../lib/utils/playwright.worker';

const mocks = vi.hoisted(() => ({ launch: vi.fn(), newContext: vi.fn(), newPage: vi.fn(), goto: vi.fn(), close: vi.fn() }));
vi.mock('@cloudflare/playwright', () => ({ launch: mocks.launch }));
vi.mock('../lib/utils/logger', () => ({ default: { debug: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.goto.mockResolvedValue(undefined);
    mocks.newPage.mockResolvedValue({ goto: mocks.goto });
    mocks.newContext.mockResolvedValue({ newPage: mocks.newPage });
    mocks.launch.mockResolvedValue({ newContext: mocks.newContext, close: mocks.close });
    setBrowserBinding({});
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Worker browser lifecycle', () => {
    it('keeps a shared browser alive for the requested lifetime and closes it immediately on cleanup', async () => {
        const { destroy } = await getPlaywrightPage('https://example.com', { noGoto: true, closeTimeout: 120000 });
        await vi.advanceTimersByTimeAsync(30000);
        expect(mocks.close).not.toHaveBeenCalled();
        await destroy();
        expect(mocks.close).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(120000);
        expect(mocks.close).toHaveBeenCalledOnce();
    });

    it('closes the browser if initial navigation fails', async () => {
        mocks.goto.mockRejectedValue(new Error('Navigation failed'));
        await expect(getPlaywrightPage('https://example.com')).rejects.toThrow('Navigation failed');
        expect(mocks.close).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(30000);
        expect(mocks.close).toHaveBeenCalledOnce();
    });

    it('allows explicit cleanup to own the lifetime of a shared page', async () => {
        const { destroy } = await getPlaywrightPage('https://example.com', { noGoto: true, closeTimeout: 0 });
        await vi.advanceTimersByTimeAsync(180000);
        expect(mocks.close).not.toHaveBeenCalled();
        await destroy();
        expect(mocks.close).toHaveBeenCalledOnce();
    });

    it.each(['context', 'page', 'callback'])('cleans up a failed %s initialization', async (stage) => {
        const failure = new Error('Initialization failed');
        if (stage === 'context') {
            mocks.newContext.mockRejectedValueOnce(failure);
        } else if (stage === 'page') {
            mocks.newPage.mockRejectedValueOnce(failure);
        }
        await expect(
            getPlaywrightPage('https://example.com', {
                noGoto: true,
                onBeforeLoad: () => {
                    if (stage === 'callback') {
                        throw failure;
                    }
                },
            })
        ).rejects.toThrow('Initialization failed');
        expect(mocks.close).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(30000);
        expect(mocks.close).toHaveBeenCalledOnce();
    });
});
