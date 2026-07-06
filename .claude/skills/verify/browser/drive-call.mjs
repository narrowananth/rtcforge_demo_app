import { chromium } from 'playwright'
import { api, authedPage, MEDIA_ARGS, seedUser, SHOTS } from './lib.mjs'

// Every peer publishes in a call, so each side should end up with ≥2 playing
// videos (self preview + remote), proving bidirectional produce↔consume.
const twoLiveVideos = () =>
    [...document.querySelectorAll('video')].filter((v) => v.readyState >= 2 && v.videoWidth > 0)
        .length >= 2

async function main() {
    const alice = await seedUser('Alice')
    const bob = await seedUser('Bob')
    await api('POST', '/api/conversations/dm', { userId: bob.user.id }, alice.token)
    console.log('  ✓ seeded DM')

    const browser = await chromium.launch({ args: MEDIA_ARGS })
    let failed = false
    try {
        const aPage = await authedPage(browser, alice)
        const bPage = await authedPage(browser, bob)
        await aPage.waitForTimeout(1500)

        await aPage.getByText('Bob').first().click()
        await aPage.getByRole('button', { name: 'Video call' }).click()
        await bPage.getByRole('button', { name: 'Accept' }).click({ timeout: 15000 })
        console.log('  ✓ video call placed and accepted')

        await aPage.waitForFunction(twoLiveVideos, { timeout: 20000 })
        await bPage.waitForFunction(twoLiveVideos, { timeout: 20000 })
        console.log('  ✓ both peers publish AND consume live video (bidirectional SFU media)')
        await aPage.screenshot({ path: `${SHOTS}/call-alice.png` })

        await aPage.getByRole('button', { name: 'Hang up' }).click()
        await bPage.waitForFunction(() => !document.querySelector('video'), { timeout: 10000 })
        console.log('  ✓ hang up → call ended for the other participant')

        console.log('\nCALL DRIVE PASSED')
    } catch (err) {
        failed = true
        console.error('\nCALL DRIVE FAILED:', err.message)
    } finally {
        await browser.close()
        process.exit(failed ? 1 : 0)
    }
}

main()
