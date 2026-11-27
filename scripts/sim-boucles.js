const fs=require('fs'),os=require('os'),path=require('path');
// Les sessions simulées ne doivent pas se mêler à celles de l'utilisateur
process.env.HARNESS_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ls-data-'));
const { runAgent } = require(path.join(__dirname,'..','src','harness','agent.js'));
function proj(){const d=fs.mkdtempSync(path.join(os.tmpdir(),'ls-'));fs.writeFileSync(path.join(d,'a.js'),'const x = 1;\nmodule.exports = x;\n');fs.writeFileSync(path.join(d,'b.js'),'b\n');return d;}
async function sim(name,gen,config={},files={}){let calls=0,waited=0;const dir=proj();
 for(const [f,c] of Object.entries(files))fs.writeFileSync(path.join(dir,f),c);
 const llm=async()=>{calls++;const out=gen(calls);return typeof out==='string'?out:JSON.stringify(out);};
 // Les pauses d'attente sont comptées sans être réellement subies
 const r=await runAgent({task:'t',projectRoot:dir,config:{maxSteps:50,_sleep:async ms=>{waited+=ms;},...config},llmGenerate:llm});
 console.log(name.padEnd(40),'appels LLM:',String(calls).padStart(3),'| attente:',String(waited/1000).padStart(3),'s | fin:',r.error||'finish');}
const write=content=>({tool:'write_file',args:{path:'a.js',content}});
(async()=>{
 await sim('A. appel identique répété',()=>({tool:'list_dir',args:{path:'.'}}));
 await sim('B. replace_code raté, args variables',n=>({tool:'replace_code',args:{path:'a.js',old_string:'inexistant '+n,new_string:'y'}}));
 await sim('C. cycle alterné list_dir/read b.js',n=>n%2?{tool:'list_dir',args:{path:'.'}}:{tool:'read_file',args:{path:'b.js'}});
 await sim('D. lectures de fichiers sans jamais agir',n=>({tool:'search_grep',args:{pattern:'x'+n,path:'.'}}));
 await sim('E. réponse toujours illisible',()=>'je réfléchis {"tool":');
 await sim('F. outil interdit répété (mode Plan)',()=>write('x'),{planMode:true});
 await sim('G. écriture qui alterne A / B',n=>write(n%2?'A':'B'));
 await sim('H. correction puis test, même échec',n=>n%2?write('essai '+n):{tool:'run_tests',args:{}},{},
  {'package.json':'{"scripts":{"test":"node t.js"}}','t.js':'console.log("attendu 2, reçu 1");process.exit(1)'});
 await sim('I. attente d\'un service absent',()=>({tool:'check_service',args:{port:9,timeout:200}}));
})();
