/**
 * 应用版本号的唯一来源。
 *
 * 为什么不用 app.getVersion()：
 *   开发态下（`electron scripts/xxx.cjs`）Electron 找不到宿主 package.json，
 *   会退回它自己的版本号，界面就会显示成 "v33.4.11" 这种鬼东西。
 *   这里由 electron-vite 在构建期把 package.json 的 version 注入进来，
 *   开发态与打包态表现一致。
 */
declare const __APP_VERSION__: string

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0'
