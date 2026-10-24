import {defineConfig,devices} from "@playwright/test";
import {profile} from "./framework/environment";
export default defineConfig({
 testDir:".",testMatch:"**/*.spec.ts",timeout:45000,expect:{timeout:10000},
 fullyParallel:false,workers:process.env.CI?1:2,retries:process.env.CI?1:0,
 reporter:[["list"],["html",{outputFolder:"reports/html",open:"never"}],["junit",{outputFile:"reports/junit.xml"}]],
 outputDir:"reports/artifacts",
 use:{baseURL:process.env.VI_BROWSER_URL||profile.baseUrl,ignoreHTTPSErrors:true,trace:"retain-on-failure",screenshot:"only-on-failure",video:"retain-on-failure"},
 projects:[
  {name:"protocols",testMatch:"scenarios/**/*.spec.ts",use:{}},
  {name:"chromium",testMatch:"playwright/specs/**/*.spec.ts",use:{...devices["Desktop Chrome"]}}
 ]
});
