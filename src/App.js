import { useState, useRef, useEffect } from "react";

// ════════════════════════════════════════════════════
//  🔧 CONFIGURACIÓN STRIPE
//  La app los genera automáticamente en el primer uso
// ════════════════════════════════════════════════════
const FREE_LIMIT = 10;

const SYSTEM_PROMPT = `Eres MedAI, un asistente clínico de inteligencia artificial diseñado exclusivamente para médicos y profesionales de la salud. Tu rol es:
1. Ayudar con consultas clínicas: síntomas, diagnósticos diferenciales, protocolos de tratamiento.
2. Proveer información farmacológica: dosis, interacciones, contraindicaciones.
3. Interpretar resultados de laboratorio y estudios clínicos.
4. Sugerir guías clínicas y evidencia científica actualizada.
5. Apoyar en urgencias con protocolos ACLS, ATLS, sepsis, etc.
IMPORTANTE: El juicio clínico final siempre es del médico. Responde en español con terminología médica apropiada.`;

const QUICK_PROMPTS = [
  { icon:"🔬", label:"Diagnóstico diferencial", text:"¿Cuáles son los diagnósticos diferenciales para " },
  { icon:"💊", label:"Dosis y fármaco",          text:"Información sobre dosis y uso clínico de " },
  { icon:"🧪", label:"Interpretar lab",           text:"Ayúdame a interpretar estos resultados: " },
  { icon:"🚨", label:"Protocolo urgencia",        text:"Protocolo de manejo para " },
  { icon:"📋", label:"Guía clínica",              text:"Guía clínica actual para manejo de " },
  { icon:"⚕️", label:"Interacción fármacos",     text:"¿Existe interacción entre " },
];

const DB = {};
const save  = (u) => { try { localStorage.setItem("medai_u", JSON.stringify(u)); } catch {} };
const load  = ()  => { try { return JSON.parse(localStorage.getItem("medai_u")); } catch { return null; } };
const clear = ()  => { try { localStorage.removeItem("medai_u"); } catch {} };

const HARDCODED_STRIPE_LINKS = {
  monthly: "https://buy.stripe.com/9B614oeVx5kq3HDbGe43T1n",
  annual:  "https://buy.stripe.com/4gM00k00DeV06TPeSq43T1m",
};

const getStripeLinks = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("medai_stripe") || "{}");
    return {
      monthly: saved.monthly || HARDCODED_STRIPE_LINKS.monthly,
      annual:  saved.annual  || HARDCODED_STRIPE_LINKS.annual,
    };
  } catch { return HARDCODED_STRIPE_LINKS; }
};
const saveStripeLinks = (d) => {
  try { localStorage.setItem("medai_stripe", JSON.stringify(d)); } catch {}
};

async function setupStripe() {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      mcp_servers: [{ type: "url", url: "https://mcp.stripe.com", name: "stripe" }],
      messages: [{
        role: "user",
        content: `Use Stripe MCP. Execute these 5 steps in order:

STEP 1: Create product
  name: "MedAI Pro"
  description: "Asistente clínico con IA - Acceso ilimitado"

STEP 2: Create MONTHLY price for that product
  unit_amount: 999
  currency: usd
  recurring interval: month

STEP 3: Create ANNUAL price for that product  
  unit_amount: 9900
  currency: usd
  recurring interval: year

STEP 4: Create payment link for MONTHLY price, quantity 1

STEP 5: Create payment link for ANNUAL price, quantity 1

After all steps complete, return ONLY this JSON (no markdown, no backticks):
{"monthly":"https://buy.stripe.com/...","annual":"https://buy.stripe.com/..."}`
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const j = JSON.parse(clean);
    if (j.monthly && j.annual) return { ok: true, monthly: j.monthly, annual: j.annual };
  } catch {}
  const links = [...text.matchAll(/https:\/\/buy\.stripe\.com\/[^\s"'\n}]+/g)].map(m => m[0]);
  if (links.length >= 2) return { ok: true, monthly: links[0], annual: links[1] };
  return { ok: false, error: "No se encontraron los links. Intenta de nuevo." };
}

async function checkPayment() {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        mcp_servers: [{ type: "url", url: "https://mcp.stripe.com", name: "stripe" }],
        messages: [{
          role: "user",
          content: `Use Stripe MCP: list 5 most recent subscriptions. Is there any with status "active" created in last 10 minutes? Return ONLY raw JSON: {"confirmed":true,"sub_id":"sub_xxx"} or {"confirmed":false}`
        }]
      })
    });
    const data = await res.json();
    const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
    try {
      const j = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (j.confirmed) return { confirmed: true, sub_id: j.sub_id };
    } catch {}
    if (text.includes('"confirmed":true') || text.includes('"confirmed": true')) {
      return { confirmed: true, sub_id: text.match(/sub_[a-zA-Z0-9]+/)?.[0] };
    }
  } catch {}
  return { confirmed: false };
}

// ════ UI COMPONENTS ══════════════════════════════

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=JetBrains+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  ::-webkit-scrollbar{width:4px}
  ::-webkit-scrollbar-thumb{background:rgba(79,195,161,0.3);border-radius:2px}
  @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-7px)}}
  @keyframes pulse{0%,100%{opacity:0.25}50%{opacity:1}}
  @keyframes gridMove{from{transform:translateY(0)}to{transform:translateY(60px)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  textarea:focus,input:focus{outline:none}
  button{cursor:pointer;border:none;background:none}
`;

function Bg() {
  return <>
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,
      backgroundImage:`linear-gradient(rgba(13,148,136,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(13,148,136,0.04) 1px,transparent 1px)`,
      backgroundSize:"60px 60px",animation:"gridMove 8s linear infinite"}}/>
    <div style={{position:"fixed",top:"-20%",left:"-10%",width:500,height:500,borderRadius:"50%",
      background:"radial-gradient(circle,rgba(13,148,136,0.08) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}}/>
    <div style={{position:"fixed",bottom:"-20%",right:"-10%",width:600,height:600,borderRadius:"50%",
      background:"radial-gradient(circle,rgba(8,145,178,0.05) 0%,transparent 70%)",pointerEvents:"none",zIndex:0}}/>
  </>;
}

function Dots() {
  return <div style={{display:"flex",gap:4,padding:"12px 16px",alignItems:"center"}}>
    {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#4fc3a1",animation:"bounce 1.2s infinite",animationDelay:`${i*0.2}s`}}/>)}
  </div>;
}

function Bubble({ msg }) {
  const me = msg.role==="user";
  return <div style={{display:"flex",justifyContent:me?"flex-end":"flex-start",marginBottom:16,animation:"fadeUp 0.3s ease"}}>
    {!me&&<div style={{width:36,height:36,borderRadius:"50%",flexShrink:0,marginRight:10,marginTop:2,background:"linear-gradient(135deg,#0d9488,#0891b2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,boxShadow:"0 2px 8px rgba(13,148,136,0.3)"}}>⚕️</div>}
    <div style={{maxWidth:"75%",padding:"12px 16px",fontSize:14,lineHeight:1.65,whiteSpace:"pre-wrap",wordBreak:"break-word",
      background:me?"linear-gradient(135deg,#0d9488,#0891b2)":"rgba(255,255,255,0.06)",color:me?"#fff":"#e2e8f0",
      borderRadius:me?"18px 18px 4px 18px":"18px 18px 18px 4px",
      border:me?"none":"1px solid rgba(255,255,255,0.08)",boxShadow:me?"0 4px 15px rgba(13,148,136,0.25)":"none"}}>{msg.content}</div>
    {me&&<div style={{width:36,height:36,borderRadius:"50%",flexShrink:0,marginLeft:10,marginTop:2,background:"rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,border:"1px solid rgba(255,255,255,0.15)"}}>👨‍⚕️</div>}
  </div>;
}

// ── Setup Screen ──────────────────────────────────
function SetupScreen({ onDone }) {
  const [phase, setPhase] = useState("idle");
  const [links, setLinks] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setPhase("running");
    const r = await setupStripe();
    if (r.ok) {
      saveStripeLinks(r);
      setLinks(r);
      setPhase("done");
    } else {
      setErrMsg(r.error);
      setPhase("error");
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(`Mensual: ${links.monthly}\nAnual: ${links.annual}`);
    setCopied(true); setTimeout(()=>setCopied(false), 2000);
  };

  const s = { card:{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:28 } };

  return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:1,position:"relative"}}>
    <div style={{width:"100%",maxWidth:460,animation:"fadeUp 0.4s ease"}}>
      <div style={{textAlign:"center",marginBottom:26}}>
        <div style={{fontSize:44,marginBottom:10}}>⚡</div>
        <h1 style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:26,fontWeight:300,color:"#e2e8f0",marginBottom:8}}>
          Configurar Stripe
        </h1>
        <p style={{color:"#64748b",fontSize:13,lineHeight:1.7}}>
          Crea tus productos y links de pago en Stripe automáticamente. Solo se hace una vez.
        </p>
      </div>

      <div style={s.card}>
        {phase==="idle"&&<>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:22}}>
            {[
              {icon:"📦",t:"Crear producto MedAI Pro",s:"En tu cuenta de Stripe"},
              {icon:"💳",t:"Generar precio mensual",s:"$9.99 / mes"},
              {icon:"📅",t:"Generar precio anual",s:"$99 / año"},
              {icon:"🔗",t:"Crear links de pago",s:"Links únicos para tus clientes"},
            ].map(x=><div key={x.t} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,padding:"10px 14px"}}>
              <span style={{fontSize:20}}>{x.icon}</span>
              <div>
                <div style={{color:"#e2e8f0",fontSize:13}}>{x.t}</div>
                <div style={{color:"#64748b",fontSize:12}}>{x.s}</div>
              </div>
            </div>)}
          </div>
          <button onClick={run} style={{width:"100%",padding:"13px 0",borderRadius:12,fontSize:15,
            background:"linear-gradient(135deg,#0d9488,#0891b2)",color:"#fff",
            fontFamily:"'Crimson Pro',Georgia,serif",letterSpacing:"0.05em",
            boxShadow:"0 4px 20px rgba(13,148,136,0.35)",marginBottom:8}}>
            ⚡ Conectar con Stripe
          </button>
          <button onClick={onDone} style={{width:"100%",padding:"10px 0",borderRadius:12,fontSize:13,color:"#475569",fontFamily:"inherit"}}>
            Omitir por ahora →
          </button>
        </>}

        {phase==="running"&&<div style={{textAlign:"center",padding:"24px 0"}}>
          <div style={{display:"flex",justifyContent:"center",gap:5,marginBottom:20}}>
            {[0,1,2,3,4].map(i=><div key={i} style={{width:10,height:10,borderRadius:"50%",background:"#4fc3a1",animation:"pulse 1.5s infinite",animationDelay:`${i*0.25}s`}}/>)}
          </div>
          <p style={{color:"#94a3b8",fontSize:14,lineHeight:1.8}}>
            Conectando con Stripe...<br/>
            Creando producto, precios y links.<br/>
            <span style={{fontSize:12,color:"#475569"}}>Espera unos 20-30 segundos.</span>
          </p>
        </div>}

        {phase==="done"&&<div>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:38,marginBottom:8}}>🎉</div>
            <h3 style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:20,color:"#4fc3a1",marginBottom:4}}>¡Listo!</h3>
            <p style={{color:"#64748b",fontSize:13}}>Links de pago creados en tu Stripe.</p>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18}}>
            {[{l:"Mensual ($9.99/mes)",v:links?.monthly},{l:"Anual ($99/año)",v:links?.annual}].map(x=><div key={x.l} style={{background:"rgba(13,148,136,0.07)",border:"1px solid rgba(79,195,161,0.2)",borderRadius:10,padding:"10px 14px"}}>
              <div style={{fontSize:11,color:"#4fc3a1",marginBottom:3,fontFamily:"'JetBrains Mono',monospace"}}>{x.l}</div>
              <div style={{fontSize:11,color:"#94a3b8",wordBreak:"break-all",fontFamily:"'JetBrains Mono',monospace"}}>{x.v}</div>
            </div>)}
          </div>
          <button onClick={copy} style={{width:"100%",padding:"10px 0",borderRadius:10,fontSize:13,
            background:copied?"rgba(79,195,161,0.15)":"rgba(255,255,255,0.04)",
            border:"1px solid rgba(79,195,161,0.2)",color:copied?"#4fc3a1":"#94a3b8",
            fontFamily:"inherit",marginBottom:8,transition:"all 0.2s"}}>
            {copied?"✓ Copiado":"📋 Copiar links"}
          </button>
          <button onClick={onDone} style={{width:"100%",padding:"13px 0",borderRadius:12,fontSize:15,
            background:"linear-gradient(135deg,#0d9488,#0891b2)",color:"#fff",
            fontFamily:"'Crimson Pro',Georgia,serif",letterSpacing:"0.05em",boxShadow:"0 4px 20px rgba(13,148,136,0.3)"}}>
            Ir a MedAI →
          </button>
        </div>}

        {phase==="error"&&<div style={{textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
          <p style={{color:"#fca5a5",fontSize:13,marginBottom:18,lineHeight:1.6}}>{errMsg}</p>
          <button onClick={run} style={{width:"100%",padding:"12px 0",borderRadius:10,fontSize:14,
            background:"linear-gradient(135deg,#0d9488,#0891b2)",color:"#fff",fontFamily:"inherit",marginBottom:8}}>
            Reintentar
          </button>
          <button onClick={onDone} style={{width:"100%",padding:"10px 0",borderRadius:10,fontSize:13,color:"#475569",fontFamily:"inherit"}}>
            Continuar sin Stripe
          </button>
        </div>}
      </div>
    </div>
  </div>;
}

// ── Auth Screen ───────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode,setMode]=useState("login");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const inp={width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"12px 16px",color:"#e2e8f0",fontSize:14,fontFamily:"'Crimson Pro',Georgia,serif",outline:"none"};
  const focus=e=>e.target.style.borderColor="rgba(79,195,161,0.4)";
  const blur=e=>e.target.style.borderColor="rgba(255,255,255,0.1)";
  const submit=()=>{
    setErr("");
    if(!email||!pass){setErr("Completa todos los campos.");return;}
    if(mode==="register"){
      if(!name){setErr("Ingresa tu nombre.");return;}
      if(DB[email]){setErr("Correo ya registrado.");return;}
      DB[email]={name,email,pass,plan:"free",used:0,sub:null};
    }else{
      if(!DB[email]){setErr("Correo no encontrado.");return;}
      if(DB[email].pass!==pass){setErr("Contraseña incorrecta.");return;}
    }
    setBusy(true);
    setTimeout(()=>{const u=DB[email];save(u);onLogin(u);},500);
  };
  return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:24,zIndex:1,position:"relative"}}>
    <div style={{width:"100%",maxWidth:400,animation:"fadeUp 0.4s ease"}}>
      <div style={{textAlign:"center",marginBottom:26}}>
        <div style={{width:60,height:60,borderRadius:14,background:"linear-gradient(135deg,rgba(13,148,136,0.2),rgba(8,145,178,0.2))",border:"1px solid rgba(79,195,161,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 12px",boxShadow:"0 0 30px rgba(13,148,136,0.15)"}}>⚕️</div>
        <h1 style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:28,fontWeight:300,color:"#e2e8f0",marginBottom:4}}>MedAI</h1>
        <p style={{color:"#4fc3a1",fontSize:11,letterSpacing:"0.2em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace"}}>Asistente Clínico</p>
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:26}}>
        <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:10,padding:4,marginBottom:20}}>
          {["login","register"].map(m=><button key={m} onClick={()=>{setMode(m);setErr("");}} style={{flex:1,padding:"8px 0",borderRadius:8,fontSize:13,fontFamily:"inherit",background:mode===m?"rgba(13,148,136,0.25)":"transparent",color:mode===m?"#4fc3a1":"#64748b",border:mode===m?"1px solid rgba(79,195,161,0.3)":"1px solid transparent"}}>{m==="login"?"Iniciar sesión":"Registrarse"}</button>)}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {mode==="register"&&<div><label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5,letterSpacing:"0.08em"}}>NOMBRE</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Dr. Juan Pérez" style={inp} onFocus={focus} onBlur={blur}/></div>}
          <div><label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5,letterSpacing:"0.08em"}}>CORREO</label><input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="doctor@hospital.com" style={inp} onFocus={focus} onBlur={blur}/></div>
          <div><label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5,letterSpacing:"0.08em"}}>CONTRASEÑA</label><input value={pass} onChange={e=>setPass(e.target.value)} type="password" placeholder="••••••••" style={inp} onFocus={focus} onBlur={blur} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
          {err&&<p style={{color:"#fca5a5",fontSize:13,textAlign:"center"}}>{err}</p>}
          <button onClick={submit} disabled={busy} style={{width:"100%",padding:"12px 0",borderRadius:10,fontSize:14,background:busy?"rgba(255,255,255,0.05)":"linear-gradient(135deg,#0d9488,#0891b2)",color:busy?"#475569":"#fff",fontFamily:"'Crimson Pro',Georgia,serif",boxShadow:busy?"none":"0 4px 20px rgba(13,148,136,0.3)",marginTop:4}}>
            {busy?"Verificando...":mode==="login"?"Entrar":"Crear cuenta"}
          </button>
        </div>
      </div>
      <div style={{marginTop:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,padding:"12px 14px"}}><div style={{fontSize:16,marginBottom:4}}>🆓</div><div style={{color:"#e2e8f0",fontSize:12}}>Gratis</div><div style={{color:"#64748b",fontSize:11}}>10 consultas</div></div>
        <div style={{background:"rgba(13,148,136,0.07)",border:"1px solid rgba(79,195,161,0.2)",borderRadius:12,padding:"12px 14px"}}><div style={{fontSize:16,marginBottom:4}}>⭐</div><div style={{color:"#4fc3a1",fontSize:12}}>Pro</div><div style={{color:"#64748b",fontSize:11}}>$9.99/mes · $99/año</div></div>
      </div>
    </div>
  </div>;
}

// ── Upgrade Modal ─────────────────────────────────
function UpgradeModal({ onClose, onConfirmed }) {
  const [billing,setBilling]=useState("annual");
  const [phase,setPhase]=useState("select");
  const [payUrl,setPayUrl]=useState("");
  const [pollN,setPollN]=useState(0);
  const [msg,setMsg]=useState("");
  const polling=useRef(false);

  const handlePay=async()=>{
    const links=getStripeLinks();
    const url=billing==="annual"?links.annual:links.monthly;
    if(!url){setMsg("Link no disponible. Ejecuta el setup de Stripe.");setPhase("error");return;}
    setPayUrl(url);
    window.open(url,"_blank");
    setPhase("waiting");
    polling.current=true;
    let n=0;
    while(polling.current&&n<24){
      n++;setPollN(n);setMsg(`Verificando con Stripe... (${n}/24)`);
      await new Promise(r=>setTimeout(r,5000));
      const r=await checkPayment();
      if(r.confirmed){polling.current=false;setPhase("success");setTimeout(()=>onConfirmed(r.sub_id),1500);return;}
    }
    polling.current=false;setPhase("timeout");setMsg("No detectamos el pago aún.");
  };
  useEffect(()=>()=>{polling.current=false;},[]);

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:24}}>
    <div style={{background:"#041a2e",border:"1px solid rgba(79,195,161,0.2)",borderRadius:24,padding:30,maxWidth:430,width:"100%",animation:"fadeUp 0.3s ease"}}>

      {phase==="select"&&<>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:34,marginBottom:8}}>⭐</div>
          <h2 style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:22,fontWeight:300,color:"#e2e8f0",marginBottom:6}}>Actualiza a Pro</h2>
          <p style={{color:"#64748b",fontSize:13}}>Acceso ilimitado a tu asistente clínico.</p>
        </div>
        <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:10,padding:4,marginBottom:14}}>
          {[{key:"monthly",label:"Mensual",price:"$9.99/mes"},{key:"annual",label:"Anual",price:"$99/año",badge:"Mejor precio"}].map(b=><button key={b.key} onClick={()=>setBilling(b.key)} style={{flex:1,padding:"9px 6px",borderRadius:8,fontSize:13,fontFamily:"inherit",lineHeight:1.4,background:billing===b.key?"rgba(13,148,136,0.25)":"transparent",color:billing===b.key?"#4fc3a1":"#64748b",border:billing===b.key?"1px solid rgba(79,195,161,0.3)":"1px solid transparent"}}>
            {b.label}<span style={{display:"block",fontSize:11,color:billing===b.key?"#4fc3a1":"#475569"}}>{b.price}</span>
            {b.badge&&<span style={{display:"block",fontSize:10,color:"#f59e0b"}}>{b.badge}</span>}
          </button>)}
        </div>
        <div style={{background:"rgba(13,148,136,0.07)",border:"1px solid rgba(79,195,161,0.2)",borderRadius:14,padding:"14px 20px",textAlign:"center",marginBottom:14}}>
          <div style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:44,color:"#4fc3a1",lineHeight:1}}>{billing==="annual"?"$99":"$9.99"}</div>
          <div style={{color:"#64748b",fontSize:12,marginTop:4}}>{billing==="annual"?"por año · $8.25/mes":"por mes"}</div>
          {billing==="annual"&&<div style={{color:"#f59e0b",fontSize:12,marginTop:4}}>🎉 Ahorras $20.88</div>}
        </div>
        <ul style={{listStyle:"none",marginBottom:14,display:"flex",flexDirection:"column",gap:6}}>
          {["Consultas ilimitadas","Respuestas prioritarias","Guías actualizadas","Soporte por correo"].map(f=><li key={f} style={{display:"flex",alignItems:"center",gap:10,color:"#cbd5e1",fontSize:13}}><span style={{color:"#4fc3a1"}}>✓</span>{f}</li>)}
        </ul>
        <button onClick={handlePay} style={{width:"100%",padding:"13px 0",borderRadius:12,fontSize:15,background:"linear-gradient(135deg,#0d9488,#0891b2)",color:"#fff",fontFamily:"'Crimson Pro',Georgia,serif",letterSpacing:"0.05em",boxShadow:"0 4px 20px rgba(13,148,136,0.35)",marginBottom:8}}>
          💳 Pagar con Stripe →
        </button>
        <button onClick={onClose} style={{width:"100%",padding:"10px 0",borderRadius:12,fontSize:13,color:"#475569",fontFamily:"inherit"}}>Volver</button>
        <p style={{textAlign:"center",fontSize:10,color:"#1e3a4a",marginTop:8,fontFamily:"'JetBrains Mono',monospace"}}>🔒 Pago seguro vía Stripe</p>
      </>}

      {phase==="waiting"&&<div style={{textAlign:"center",padding:"20px 0"}}>
        <div style={{display:"flex",justifyContent:"center",gap:5,marginBottom:18}}>
          {[0,1,2,3,4].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:i<(pollN%6)?"#4fc3a1":"rgba(79,195,161,0.15)",transition:"background 0.3s"}}/>)}
        </div>
        <h3 style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:18,color:"#e2e8f0",marginBottom:8}}>Verificando pago</h3>
        <p style={{color:"#64748b",fontSize:13,marginBottom:6,lineHeight:1.6}}>Completa el pago en la ventana de Stripe.</p>
        <p style={{color:"#475569",fontSize:11,marginBottom:18,fontFamily:"'JetBrains Mono',monospace"}}>{msg}</p>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <a href={payUrl} target="_blank" rel="noopener noreferrer" style={{display:"block",padding:"10px 0",borderRadius:10,background:"rgba(13,148,136,0.15)",border:"1px solid rgba(79,195,161,0.3)",color:"#4fc3a1",textDecoration:"none",textAlign:"center",fontSize:13}}>🔗 Reabrir checkout</a>
          <button onClick={()=>onConfirmed(null)} style={{padding:"10px 0",borderRadius:10,fontSize:12,background:"rgba(255,255,255,0.04)",color:"#64748b",fontFamily:"inherit"}}>Ya pagué — activar manualmente</button>
        </div>
      </div>}

      {phase==="success"&&<div style={{textAlign:"center",padding:"20px 0"}}>
        <div style={{fontSize:48,marginBottom:12}}>🎉</div>
        <h3 style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:22,color:"#4fc3a1",marginBottom:8}}>¡Pago confirmado!</h3>
        <p style={{color:"#94a3b8",fontSize:14}}>Activando Plan Pro...</p>
      </div>}

      {(phase==="timeout"||phase==="error")&&<div style={{textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:12}}>⏱️</div>
        <h3 style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:18,color:"#e2e8f0",marginBottom:8}}>
          {phase==="error"?"Error":"Tiempo agotado"}
        </h3>
        <p style={{color:"#94a3b8",fontSize:13,lineHeight:1.6,marginBottom:18}}>{msg}</p>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {payUrl&&<a href={payUrl} target="_blank" rel="noopener noreferrer" style={{display:"block",padding:"10px 0",borderRadius:10,background:"rgba(13,148,136,0.15)",border:"1px solid rgba(79,195,161,0.3)",color:"#4fc3a1",textDecoration:"none",textAlign:"center",fontSize:13}}>🔗 Ir al checkout</a>}
          <button onClick={()=>onConfirmed(null)} style={{padding:"11px 0",borderRadius:10,fontSize:13,background:"linear-gradient(135deg,#0d9488,#0891b2)",color:"#fff",fontFamily:"inherit"}}>✅ Ya pagué — activar Pro</button>
          <button onClick={()=>setPhase("select")} style={{padding:"10px 0",borderRadius:10,fontSize:12,color:"#475569",fontFamily:"inherit"}}>← Volver</button>
        </div>
      </div>}
    </div>
  </div>;
}

// ════ MAIN ═══════════════════════════════════════
export default function MedAI() {
  const [setupDone,setSetupDone]=useState(true);
  const [user,setUser]=useState(()=>load());
  const [msgs,setMsgs]=useState([]);
  const [input,setInput]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState(null);
  const [welcome,setWelcome]=useState(true);
  const [upgrade,setUpgrade]=useState(false);
  const [used,setUsed]=useState(()=>load()?.used||0);
  const bottomRef=useRef(null);
  const taRef=useRef(null);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[msgs,busy]);

  const isPro=user?.plan==="pro";
  const left=FREE_LIMIT-used;
  const limitReached=!isPro&&used>=FREE_LIMIT;

  const handleConfirmed=(sid)=>{
    const u={...user,plan:"pro",sub:sid};
    DB[user.email]=u;save(u);setUser(u);setUpgrade(false);
  };

  const send=async(txt)=>{
    const t=(txt||input).trim();
    if(!t||busy)return;
    if(limitReached){setUpgrade(true);return;}
    setWelcome(false);setInput("");setErr(null);
    const newMsgs=[...msgs,{role:"user",content:t}];
    setMsgs(newMsgs);setBusy(true);
    const n=used+1;setUsed(n);
    const u={...user,used:n};DB[user.email]=u;save(u);
    try{
      const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:SYSTEM_PROMPT,messages:newMsgs})});
      const data=await res.json();
      setMsgs([...newMsgs,{role:"assistant",content:data.content?.[0]?.text||"Sin respuesta."}]);
    }catch{setErr("Error de conexión.");}
    finally{setBusy(false);}
  };

  const WRAP={minHeight:"100vh",background:"linear-gradient(160deg,#020c14 0%,#041a2e 40%,#030f1e 100%)",display:"flex",flexDirection:"column",fontFamily:"'Georgia','Times New Roman',serif",color:"#e2e8f0",position:"relative",overflow:"hidden"};

  if(!setupDone) return <div style={WRAP}><style>{CSS}</style><Bg/><SetupScreen onDone={()=>setSetupDone(true)}/></div>;
  if(!user)      return <div style={WRAP}><style>{CSS}</style><Bg/><AuthScreen onLogin={u=>{setUser(u);}}/></div>;

  return <div style={WRAP}>
    <style>{CSS}</style><Bg/>
    {upgrade&&<UpgradeModal onClose={()=>setUpgrade(false)} onConfirmed={handleConfirmed}/>}

    {/* Header */}
    <header style={{position:"sticky",top:0,zIndex:50,background:"rgba(2,12,20,0.85)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(79,195,161,0.15)",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:64}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#0d9488,#0891b2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,boxShadow:"0 0 20px rgba(13,148,136,0.4)"}}>⚕️</div>
        <div>
          <div style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:18,fontWeight:600}}>MedAI</div>
          <div style={{fontSize:10,color:"#4fc3a1",letterSpacing:"0.15em",textTransform:"uppercase",fontFamily:"'JetBrains Mono',monospace"}}>Asistente Clínico</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {isPro
          ?<div style={{background:"rgba(13,148,136,0.15)",border:"1px solid rgba(79,195,161,0.3)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"#4fc3a1",fontFamily:"'JetBrains Mono',monospace"}}>⭐ PRO</div>
          :<button onClick={()=>setUpgrade(true)} style={{background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.25)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"#f59e0b",fontFamily:"'JetBrains Mono',monospace"}}>
            {left>0?`${left} restantes`:"Sin consultas"} · $99/año
          </button>
        }
        <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"5px 12px"}}>
          <span style={{fontSize:11,color:"#94a3b8"}}>{user.name?.split(" ")[0]||user.email.split("@")[0]}</span>
          <button onClick={()=>{clear();setUser(null);setMsgs([]);setWelcome(true);setUsed(0);}} style={{color:"#475569",fontSize:11,fontFamily:"inherit"}}>Salir</button>
        </div>
      </div>
    </header>

    <main style={{flex:1,display:"flex",flexDirection:"column",zIndex:1,position:"relative"}}>
      {welcome&&<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px",animation:"fadeUp 0.5s ease"}}>
        <div style={{width:68,height:68,borderRadius:16,background:"linear-gradient(135deg,rgba(13,148,136,0.2),rgba(8,145,178,0.2))",border:"1px solid rgba(79,195,161,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,marginBottom:18,boxShadow:"0 0 40px rgba(13,148,136,0.15)"}}>⚕️</div>
        <h1 style={{fontFamily:"'Crimson Pro',Georgia,serif",fontSize:"clamp(22px,5vw,36px)",fontWeight:300,textAlign:"center",marginBottom:10}}>
          Bienvenido, <span style={{color:"#4fc3a1"}}>Dr. {user.name?.split(" ")[0]||"Doctor"}</span>
        </h1>
        <p style={{color:"#64748b",fontSize:14,textAlign:"center",maxWidth:420,lineHeight:1.7,marginBottom:20,fontFamily:"'Crimson Pro',Georgia,serif"}}>
          Consulte diagnósticos, fármacos, protocolos y guías clínicas con inteligencia artificial.
        </p>
        {!isPro&&<div style={{background:"rgba(245,158,11,0.07)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:12,padding:"9px 18px",marginBottom:20,fontSize:13,color:"#f59e0b",display:"flex",alignItems:"center",gap:10}}>
          <span>{left} de {FREE_LIMIT} consultas disponibles</span>
          <button onClick={()=>setUpgrade(true)} style={{color:"#fbbf24",fontSize:12,textDecoration:"underline",fontFamily:"inherit"}}>Pro $99/año →</button>
        </div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:10,width:"100%",maxWidth:620}}>
          {QUICK_PROMPTS.map((qp,i)=><button key={i} onClick={()=>{setInput(qp.text);taRef.current?.focus();}}
            style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"13px 15px",textAlign:"left",color:"#cbd5e1",fontSize:13,fontFamily:"'Crimson Pro',Georgia,serif",transition:"all 0.2s"}}
            onMouseOver={e=>{e.currentTarget.style.background="rgba(13,148,136,0.1)";e.currentTarget.style.borderColor="rgba(79,195,161,0.3)";}}
            onMouseOut={e=>{e.currentTarget.style.background="rgba(255,255,255,0.03)";e.currentTarget.style.borderColor="rgba(255,255,255,0.08)";}}>
            <span style={{fontSize:18,display:"block",marginBottom:5}}>{qp.icon}</span>{qp.label}
          </button>)}
        </div>
      </div>}

      {!welcome&&<div style={{flex:1,overflowY:"auto",padding:"24px"}}>
        <div style={{maxWidth:740,width:"100%",margin:"0 auto"}}>
          {msgs.map((m,i)=><Bubble key={i} msg={m}/>)}
          {busy&&<div style={{display:"flex",justifyContent:"flex-start",marginBottom:16}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#0d9488,#0891b2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,marginRight:10,flexShrink:0}}>⚕️</div>
            <div style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"18px 18px 18px 4px"}}><Dots/></div>
          </div>}
          {err&&<div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,padding:"10px 16px",color:"#fca5a5",fontSize:13,textAlign:"center",marginBottom:12}}>{err}</div>}
          <div ref={bottomRef}/>
        </div>
      </div>}

      {/* Input bar */}
      <div style={{position:"sticky",bottom:0,background:"rgba(2,12,20,0.9)",backdropFilter:"blur(20px)",borderTop:"1px solid rgba(79,195,161,0.1)",padding:"12px 20px 16px"}}>
        <div style={{maxWidth:740,margin:"0 auto"}}>
          {!welcome&&<div style={{display:"flex",gap:8,marginBottom:8,overflowX:"auto",paddingBottom:2}}>
            {QUICK_PROMPTS.map((qp,i)=><button key={i} onClick={()=>{setInput(qp.text);taRef.current?.focus();}}
              style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"5px 12px",color:"#94a3b8",fontSize:12,whiteSpace:"nowrap",flexShrink:0,fontFamily:"inherit",transition:"all 0.2s"}}
              onMouseOver={e=>{e.currentTarget.style.background="rgba(13,148,136,0.1)";e.currentTarget.style.color="#4fc3a1";}}
              onMouseOut={e=>{e.currentTarget.style.background="rgba(255,255,255,0.04)";e.currentTarget.style.color="#94a3b8";}}>
              {qp.icon} {qp.label}
            </button>)}
          </div>}
          {limitReached&&<div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:10,padding:"9px 14px",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
            <span style={{fontSize:13,color:"#f59e0b"}}>Límite gratuito alcanzado.</span>
            <button onClick={()=>setUpgrade(true)} style={{background:"linear-gradient(135deg,#d97706,#f59e0b)",color:"#fff",borderRadius:8,padding:"5px 12px",fontSize:12,fontFamily:"inherit",flexShrink:0}}>Pro $99/año →</button>
          </div>}
          <div style={{display:"flex",gap:10,alignItems:"flex-end",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(79,195,161,0.2)",borderRadius:16,padding:"10px 14px",opacity:limitReached?0.5:1}}>
            <textarea ref={taRef} value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
              disabled={busy||limitReached}
              placeholder={limitReached?"Activa Pro para continuar...":"Describa el caso clínico o su consulta..."}
              rows={1} style={{flex:1,background:"transparent",border:"none",color:"#e2e8f0",fontSize:14,resize:"none",fontFamily:"'Crimson Pro',Georgia,serif",lineHeight:1.6,maxHeight:120,overflowY:"auto"}}
              onInput={e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";}}/>
            <button onClick={()=>send()} disabled={!input.trim()||busy||limitReached} style={{width:38,height:38,borderRadius:10,flexShrink:0,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",
              background:input.trim()&&!busy&&!limitReached?"linear-gradient(135deg,#0d9488,#0891b2)":"rgba(255,255,255,0.05)",
              color:input.trim()&&!busy&&!limitReached?"#fff":"#475569",
              boxShadow:input.trim()&&!busy&&!limitReached?"0 4px 15px rgba(13,148,136,0.3)":"none",transition:"all 0.2s"}}>
              {busy?"⏳":"↑"}
            </button>
          </div>
          <p style={{textAlign:"center",fontSize:10,color:"#1e3a4a",marginTop:7,letterSpacing:"0.08em",fontFamily:"'JetBrains Mono',monospace"}}>
            MedAI · No reemplaza el criterio médico profesional
          </p>
        </div>
      </div>
    </main>
  </div>;
}
