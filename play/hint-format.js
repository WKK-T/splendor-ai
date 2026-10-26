/* Deterministic, visible-state-only Chinese action descriptions. */
(function(root){
  const names=['白宝石','蓝宝石','绿宝石','红宝石','黑宝石','黄金'];
  const pairs=[[0,1],[0,2],[0,3],[0,4],[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]];
  const triples=[[0,1,2],[0,1,3],[0,1,4],[0,2,3],[0,2,4],[0,3,4],[1,2,3],[1,2,4],[1,3,4],[2,3,4]];
  const gems = a => a.map((n,i)=>n?`${names[i]} ${n} 枚`:null).filter(Boolean).join('、') || '无需筹码';
  function describe(s,i,data){
    const card = id => {if(id==null)return '此前牌面未公开';const c=data.cards[id];return `${names[c.bonus]}折扣，${c.points} 分，牌面费用：${gems(c.cost)}`;};
    const target = n => {const t=Math.floor(n/4),slot=n%4;return `${t+1} 级从左第 ${slot+1} 张（${card(s.display[t][slot])}）`;};
    if(i<25) return `取${(i<5?[i]:i<15?pairs[i-5]:triples[i-15]).map(c=>names[c]).join('、')}各 1 枚。`;
    if(i<30) return `取${names[i-25]} 2 枚。`;
    if(i<42) return `预留${target(i-30)}。${s.bank[5]?'同时获得 1 枚黄金。':'筹码池无黄金。'}`;
    if(i<45) return `从 ${i-41} 级牌堆盲预留 1 张（牌面未知）。${s.bank[5]?'同时获得 1 枚黄金。':'筹码池无黄金。'}`;
    if(i<57) return `购买${target(i-45)}。`;
    if(i<60) return `购买自己的第 ${i-56} 张预留牌（${card(s.players[s.current].reserved[i-57])}）。`;
    if(i<66) return `归还${names[i-60]} 1 枚。`;
    if(i<76) { const n=i-66; return `领取场上从左第 ${s.nobles.indexOf(n)+1} 位贵族（永久折扣要求：${gems(data.nobles[n].req).replaceAll('枚','张')}），获得 ${data.nobles[n].points} 分。`; }
    if(i===76) return '当前无其他合法行动，跳过本回合。';
    const color=s.pending_purchase.remaining_cost.findIndex(n=>n>0);
    return `支付${names[i-77]} 1 枚${i===82?`，抵扣${names[color]}费用`:''}。`;
  }
  function summarize(steps){
    const lines=[];
    for(let n=0;n<steps.length;){
      const step=steps[n];
      if(step.index>=77 || (step.index>=60&&step.index<66)){
        const paying=step.index>=77, counts=Array(6).fill(0), substitutes=Array(5).fill(0);
        while(n<steps.length&&(paying?steps[n].index>=77:steps[n].index>=60&&steps[n].index<66)){
          const st=steps[n++]; counts[st.index-(paying?77:60)]++;
          if(paying&&st.index===82)substitutes[st.paymentColor]++;
        }
        lines.push(`${paying?'支付':'归还'}${gems(counts)}${substitutes.some(Boolean)?`（黄金用于抵扣${gems(substitutes)}）`:''}。`);
      } else {lines.push(step.text); n++;}
    }
    return lines;
  }
  root.SplendorHintText={describe,summarize};
})(globalThis);
