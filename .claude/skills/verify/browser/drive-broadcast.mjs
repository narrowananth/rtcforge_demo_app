import { chromium } from 'playwright'
import { api, authedPage, MEDIA_ARGS, seedUser, SHOTS } from './lib.mjs'

async function main() {
    const alice = await seedUser('Alice')
    const bob = await seedUser('Bob')
    await api(
        'POST',
        '/api/conversations/broadcast',
        { title: 'LiveShow', memberIds: [bob.user.id] },
        alice.token,
    )
    console.log('  ✓ seeded broadcaster + viewer + broadcast list')

    const browser = await chromium.launch({ args: MEDIA_ARGS })
    let failed = false
    try {
        const aPage = await authedPage(browser, alice)
        const bPage = await authedPage(browser, bob)
        await aPage.waitForTimeout(1500)

        await aPage.getByText('LiveShow').first().click()
        await aPage.getByRole('button', { name: 'Go live (broadcast)' }).click()
        await aPage.waitForSelector('video', { timeout: 15000 })
        console.log('  ✓ broadcaster went live (local camera published)')

        await bPage.getByRole('button', { name: 'Accept' }).click({ timeout: 15000 })
        console.log('  ✓ viewer accepted the incoming broadcast')

        await bPage.waitForFunction(
            () =>
                [...document.querySelectorAll('video')].some(
                    (v) => v.readyState >= 2 && v.videoWidth > 0,
                ),
            { timeout: 20000 },
        )
        const dims = await bPage.evaluate(() => {
            const v = [...document.querySelectorAll('video')].find(
                (x) => x.readyState >= 2 && x.videoWidth > 0,
            )
            return v ? `${v.videoWidth}x${v.videoHeight}` : '?'
        })
        console.log(`  ✓ viewer decoded live video frames ${dims} (SFU media flowing)`)
        await bPage.screenshot({ path: `${SHOTS}/viewer-watching.png` })

        await aPage.getByRole('button', { name: 'Hang up' }).click()
        await bPage.waitForFunction(
            () => document.body.innerText.includes('broadcaster ended the live stream'),
            { timeout: 10000 },
        )
        console.log('  ✓ broadcaster left → viewer saw "broadcaster ended the live stream"')
        await bPage.screenshot({ path: `${SHOTS}/viewer-stream-ended.png` })

        console.log('\nBROADCAST DRIVE PASSED')
    } catch (err) {
        failed = true
        console.error('\nBROADCAST DRIVE FAILED:', err.message)
    } finally {
        await browser.close()
        process.exit(failed ? 1 : 0)
    }
}

main()
