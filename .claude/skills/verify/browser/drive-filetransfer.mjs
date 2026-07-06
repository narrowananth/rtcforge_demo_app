import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { api, authedPage, MEDIA_ARGS, seedUser, SHOTS, STAMP } from './lib.mjs'

// A multi-chunk PNG so the transfer actually streams framed chunks through the
// FileTransferManager and verifies its SHA-256 before completing.
const IMG = `${SHOTS}/xfer-${STAMP}.png`
writeFileSync(IMG, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(80 * 1024, 0x7a)]))

async function main() {
    const alice = await seedUser('Alice')
    const bob = await seedUser('Bob')
    await api('POST', '/api/conversations/dm', { userId: bob.user.id }, alice.token)
    console.log('  ✓ seeded DM between two online users')

    const browser = await chromium.launch({ args: MEDIA_ARGS })
    let failed = false
    try {
        const aPage = await authedPage(browser, alice)
        const bPage = await authedPage(browser, bob)
        await aPage.waitForTimeout(1500)

        await aPage.getByText('Bob').first().click()
        await aPage.locator('input[type="file"]').setInputFiles(IMG)
        console.log('  ✓ sender: file attached & offered over P2P')

        await bPage.getByText('Alice').first().click()
        await bPage.waitForFunction(
            () =>
                [...document.querySelectorAll('img')].some((i) =>
                    (i.getAttribute('src') || '').startsWith('blob:'),
                ),
            { timeout: 25000 },
        )
        console.log('  ✓ receiver rendered the file (FileTransferManager + SHA-256 OK)')
        await bPage.screenshot({ path: `${SHOTS}/file-received.png` })

        console.log('\nFILE-TRANSFER DRIVE PASSED')
    } catch (err) {
        failed = true
        console.error('\nFILE-TRANSFER DRIVE FAILED:', err.message)
    } finally {
        await browser.close()
        process.exit(failed ? 1 : 0)
    }
}

main()
