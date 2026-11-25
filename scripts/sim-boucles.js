const fs=require('fs'),os=require('os'),path=require('path');
const { runAgent } = require(path.join(__dirname,'..','src','harness','agent.js'));
function proj(){const d=fs.mkdtempSync(path.join(os.tmpdir(),'ls-'));fs.writeFileSync(path.join(d,'a.js'),'const x = 1;\nmodule.exports = x;\n');fs.writeFileSync(path.join(d,'b.js'),'b\n');return d;}
async function sim(name,gen){let calls=0;const ev=[];
 const llm=async()=>{calls++;return JSON.stringify(gen(calls));};
 const r=await runAgent({task:'t',projectRoot:proj(),config:{maxSteps:50},llmGenerate:llm,onEvent:e=>ev.push(e)});
 console.log(name.padEnd(34),'appels LLM:',String(calls).padStart(3),'| fin:',r.error||'finish');}
(async()=>{
 await sim('A. appel identique répété',()=>({tool:'list_dir',args:{path:'.'}}));
 await sim('B. replace_code raté, args variables',n=>({tool:'replace_code',args:{path:'a.js',old_string:'inexistant '+n,new_string:'y'}}));
 await sim('C. cycle alterné list_dir/read b.js',n=>n%2?{tool:'list_dir',args:{path:'.'}}:{tool:'read_file',args:{path:'b.js'}});
 await sim('D. lectures de fichiers sans jamais agir',n=>({tool:'search_grep',args:{pattern:'x'+n,path:'.'}}));
})();
