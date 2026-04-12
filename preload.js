const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  fetchLotteryData: (lotteryType) => ipcRenderer.invoke('fetch-lottery-data', lotteryType),
  getRecommendation: (lotteryType, historyData) => ipcRenderer.invoke('get-recommendation', lotteryType, historyData),
  exportHistoryData: (lotteryType, historyData) => ipcRenderer.invoke('export-history-data', lotteryType, historyData)
});
