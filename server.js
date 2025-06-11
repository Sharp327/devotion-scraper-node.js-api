const express = require('express')
const { chromium } = require('playwright')
const fs = require('fs')
const PORT = process.env.PORT || 3001
const cors = require('cors') // <-- add this
const app = express()
app.use(cors())

function daysBetween(date1, date2) {
  const d1 = new Date(Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate()))
  const d2 = new Date(Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate()))
  const diffTime = Math.abs(d2.getTime() - d1.getTime())
  return Math.floor(diffTime / (1000 * 60 * 60 * 24))
}

async function getDevotionByDate(dateString) {
  const requestedDate = new Date(dateString)
  const now = new Date()

  if (isNaN(requestedDate.getTime())) {
    throw new Error('Invalid date')
  }

  const dayDiff = daysBetween(now, requestedDate)

  if(dayDiff < 0){
    return null;
  }

  const page = Math.floor(dayDiff / 18) + 1
  const articleIndex = ((dayDiff % 18) == 0 ? 18 : (dayDiff % 18)) - 1

  const browser = await chromium.launch({ headless: true })
  const pageCtx = await browser.newPage()
  try {
    await pageCtx.goto(`https://www.intouch.org/read/daily-devotions/all?page=${page}`, {
      waitUntil: 'networkidle',
      timeout: 60000
    })
  } catch (err) {
    await browser.close()
    throw new Error('Failed to load listing page: ' + err.message)
  }

  await pageCtx.waitForSelector('article.card a')

  const articles = await pageCtx.$$eval('article.card a', anchors =>
    anchors.map(a => ({
      href: a.getAttribute('href'),
      dateText: a.querySelector('.card--date')?.textContent?.trim() || ''
    }))
  )

  const selected = articles[articleIndex]
  if (!selected || !selected.href) {
    throw new Error('Devotion not found')
  }

  const detailUrl = `https://www.intouch.org${selected.href}`

  try {
    await pageCtx.goto(detailUrl, { waitUntil: 'networkidle', timeout: 60000 })
  } catch (err) {
    await browser.close()
    throw new Error('Failed to load devotion detail page: ' + err.message)
  }
  const title = await pageCtx.$eval('h1.h1', el => el.textContent?.trim() || '')

  // Attempt to get subtitle if present
  let subtitle = ''
  try {
    subtitle = await pageCtx.$eval('h1.h1 + div > p', el => el.textContent?.trim() || '')
  } catch {}

  // Extract related Scripture dropdowns
  const relatedScripture = await pageCtx.$$eval('#js--dropdowns > div', dropdowns =>
    dropdowns.map((el, index) => ({
      title: el.querySelector('.js--dropdown-title button > span')?.textContent?.trim() || '',
      content: el.querySelector(`.js--dropdown-content-${index+1}`)?.innerHTML || ''
    }))
  )

  const articleContent = await pageCtx.$eval('.js-scripturize', el => el.innerHTML)

  await browser.close()

  return {
    title,
    subtitle,
    date: selected.dateText,
    relatedScripture,
    content: articleContent,
    link: detailUrl,
  }
}

app.get('/devotion', async (req, res) => {
  const { date } = req.query

  if (!date) {
    return res.status(400).json({ error: 'Missing date query param' })
  }

  try {
    const data = await getDevotionByDate(date)
    res.json(data)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Failed to fetch devotion' })
  }
})

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`)
})
