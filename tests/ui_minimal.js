async (page) => {
  const errors = [];
  const fontRequests = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontRequests.push(request.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:7310");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("combobox", { name: "当前研究项目" })
    .selectOption({ label: "蛋白质界面预测" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".metric-card").nth(3).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".metric-card")].every((card) =>
      [...card.querySelectorAll("svg path")].some(
        (path) =>
          path.getAttribute("stroke-width") === "2.3" &&
          (path.getAttribute("d") || "").length > 40,
      ),
    ),
  );
  const font = await page
    .locator("body")
    .evaluate((e) => getComputedStyle(e).fontFamily);
  if (!font.includes("system-ui") || font.includes("HarmonyOS"))
    throw new Error("Wrong UI font");
  if (await page.locator("main p").count())
    throw new Error("Overview prose remains");
  if (/HarmonyOS|字体/.test(await page.locator("body").innerText()))
    throw new Error("Visible font annotation");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const doc = await cdp.send("DOM.getDocument");
  const node = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: "h1",
  });
  const actual = await cdp.send("CSS.getPlatformFontsForNode", {
    nodeId: node.nodeId,
  });
  const chartNode = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: ".metric-card svg text",
  });
  const chartFont = await cdp.send("CSS.getPlatformFontsForNode", {
    nodeId: chartNode.nodeId,
  });
  if (!chartFont.fonts.length || chartFont.fonts.some((f) => f.isCustomFont))
    throw new Error("Chart must use system fonts");
  if (!actual.fonts.length || actual.fonts.some((f) => f.isCustomFont))
    throw new Error("Heading must use system fonts");
  await page.screenshot({
    path: "tests/browser-output/metrics-desktop.png",
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "筛选指标" }).fill("ROC");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".metric-card h2")].every((e) =>
      e.textContent.includes("ROC"),
    ),
  );
  const filtered = await page.locator(".metric-card").count();
  if (!filtered) throw new Error("Metric filter returned no charts");
  await page.getByRole("textbox", { name: "筛选指标" }).fill("");
  await page.getByRole("button", { name: "实验记录", exact: true }).click();
  await page
    .getByRole("checkbox", { name: /^选择 / })
    .nth(0)
    .check();
  await page
    .getByRole("checkbox", { name: /^选择 / })
    .nth(1)
    .check();
  await page.getByRole("button", { name: "对比实验", exact: true }).click();
  await page.getByRole("combobox", { name: "选择曲线指标" }).waitFor();
  await page.getByRole("button", { name: "参数配置", exact: true }).click();
  await page.getByRole("button", { name: "新建配置", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  if (await page.getByRole("dialog").locator("p").count())
    throw new Error("Dialog prose remains");
  await page.screenshot({ path: "tests/browser-output/config-dialog.png" });
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await page.getByRole("button", { name: "接入", exact: true }).click();
  if (await page.locator("main p").count())
    throw new Error("Connection prose remains");
  await page.getByRole("button", { name: "Python", exact: true }).click();
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await page.screenshot({
    path: "tests/browser-output/connect.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["实验总览", "参数配置", "超参数搜索"]) {
    await page.getByRole("button", { name, exact: true }).click();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Mobile overflow: " + name);
  }
  await page.getByRole("button", { name: "实验总览", exact: true }).click();
  await page.locator(".metric-card").nth(3).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".metric-card")].every((card) =>
      [...card.querySelectorAll("svg path")].some(
        (path) =>
          path.getAttribute("stroke-width") === "2.3" &&
          (path.getAttribute("d") || "").length > 40,
      ),
    ),
  );
  await page.screenshot({
    path: "tests/browser-output/metrics-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  if (errors.length) throw new Error(errors.join("\n"));
  if (fontRequests.length)
    throw new Error("Unexpected font downloads: " + fontRequests.join(", "));
  return {
    passed: true,
    font,
    actualFonts: actual.fonts,
    chartFonts: chartFont.fonts,
    metricCards: 4,
    filteredCards: filtered,
    visibleFontAnnotation: false,
    overviewParagraphs: 0,
    connectionParagraphs: 0,
    mutations: false,
    fontRequests,
    pageErrors: errors,
  };
}
