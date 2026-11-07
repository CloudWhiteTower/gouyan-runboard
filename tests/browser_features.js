async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("http://127.0.0.1:7311");
  await page
    .getByRole("combobox", { name: "当前研究项目" })
    .selectOption({ label: "功能验收" });
  await page.locator(".metric-card").first().waitFor();
  await page
    .getByRole("combobox", { name: "图表横轴" })
    .selectOption("relative");
  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  await page.reload();
  if (
    (await page.getByRole("combobox", { name: "图表横轴" }).inputValue()) !==
    "relative"
  )
    throw new Error("View not restored");
  await page.getByRole("combobox", { name: "图表横轴" }).selectOption("wall");
  await page.getByRole("combobox", { name: "图表横轴" }).selectOption("step");
  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  await page.getByRole("button", { name: "实验记录", exact: true }).click();
  await page
    .getByRole("combobox", { name: "筛选分组" })
    .selectOption("baseline");
  if ((await page.locator(".runs-table tbody tr").count()) !== 1)
    throw new Error("Group filter failed");
  await page.getByRole("button", { name: "曲线基线", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "实验详情" });
  await detail.getByRole("button", { name: "系统", exact: true }).click();
  await detail.locator(".system-charts section").nth(3).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('.system-charts svg path[stroke-width="2.3"]'),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".system-charts [data-chart-state]")].every(
      (chart) => chart.dataset.chartState === "ready",
    ),
  );
  await page.screenshot({
    path: "tests/browser-output/system-desktop.png",
    animations: "disabled",
  });
  await detail.getByRole("button", { name: "日志", exact: true }).click();
  await detail
    .getByRole("textbox", { name: "搜索日志" })
    .fill("console capture");
  await detail
    .locator("[role=log]")
    .getByText("console capture verified", { exact: true })
    .waitFor();
  await page.screenshot({ path: "tests/browser-output/logs-desktop.png" });
  await detail.getByRole("button", { name: "环境", exact: true }).click();
  await detail.getByText("Python", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "文件", exact: true }).click();
  await detail
    .getByLabel("上传文件")
    .setInputFiles("tests/browser-output/browser-upload.bin");
  await detail
    .getByRole("button", { name: "browser-upload.bin", exact: true })
    .waitFor();
  await detail
    .getByRole("button", { name: "metrics.csv", exact: true })
    .click();
  await detail
    .locator(".file-preview pre")
    .getByText("epoch,loss", { exact: false })
    .waitFor();
  await detail.getByRole("button", { name: "trace.pdb", exact: true }).click();
  await detail.getByRole("img", { name: "可旋转蛋白质骨架" }).waitFor();
  if ((await detail.locator(".protein-trace svg line").count()) !== 7)
    throw new Error("PDB trace not loaded");
  await page.screenshot({ path: "tests/browser-output/structure-desktop.png" });
  await detail.getByRole("button", { name: "sample.wav", exact: true }).click();
  await detail.locator("audio").waitFor();
  await detail.getByRole("button", { name: "charts", exact: true }).click();
  await detail
    .getByRole("button", { name: "residue-score-7.json", exact: true })
    .click();
  await detail.locator(".file-preview [role=img]").waitFor();
  await detail.getByRole("button", { name: "管理", exact: true }).click();
  await detail
    .getByRole("textbox", { name: "实验标签" })
    .fill("验收, GAT, 浏览器");
  await detail.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已保存", { exact: true }).waitFor();
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("combobox", { name: "筛选标签" }).selectOption("浏览器");
  if ((await page.locator(".runs-table tbody tr").count()) !== 1)
    throw new Error("Label filter failed");
  await page.getByRole("combobox", { name: "筛选标签" }).selectOption("");
  await page.getByRole("combobox", { name: "筛选分组" }).selectOption("");
  await page
    .getByRole("checkbox", { name: "选择 曲线基线", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "选择 曲线候选", exact: true })
    .check();
  await page.getByRole("button", { name: "对比实验", exact: true }).click();
  await page
    .getByRole("combobox", { name: "选择曲线指标" })
    .selectOption("val/loss");
  await page.getByRole("combobox", { name: "结果汇总" }).selectOption("best");
  await page.waitForFunction(() =>
    document
      .querySelector(".metric-results tbody")
      ?.textContent.includes("0.08"),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-chart-state]")].every(
      (chart) => chart.dataset.chartState === "ready",
    ),
  );
  await page.screenshot({
    path: "tests/browser-output/compare-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile compare overflow");
  await page.getByRole("button", { name: "文件与产物", exact: true }).click();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile file overflow");
  await page.screenshot({
    path: "tests/browser-output/files-mobile.png",
    fullPage: true,
  });
  const records = await page.evaluate(() =>
    fetch("/api/runs").then((response) => response.json()),
  );
  const baseline = records.find((record) => record.name === "曲线基线");
  const uploaded = await page.evaluate(
    async (id) =>
      Array.from(
        new Uint8Array(
          await (
            await fetch(`/api/runs/${id}/download?path=browser-upload.bin`)
          ).arrayBuffer(),
        ),
      ),
    baseline.id,
  );
  if (uploaded.join(",") !== "0,1,2,255")
    throw new Error("Upload changed binary data");
  await page.setViewportSize({ width: 1440, height: 1050 });
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    passed: true,
    pageErrors: errors,
    checks: [
      "saved view",
      "time axes",
      "group and label filtering",
      "system curves",
      "logs",
      "environment",
      "binary upload/download",
      "CSV preview",
      "PDB trace",
      "audio preview",
      "custom chart",
      "best-value comparison",
      "390px layout",
    ],
    store: "isolated 7311",
  };
}
