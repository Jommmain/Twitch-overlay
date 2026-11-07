// Node-only test adapter for Electron utilityProcess parentPort. Dummy data only.
process.parentPort={on:(event,fn)=>{if(event==='message')process.on('message',data=>fn({data}));},postMessage:value=>process.send?.(value)};
