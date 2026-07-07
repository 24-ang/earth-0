import { Type } from "typebox";
import { gameState } from "../../engine/state.ts";

export default {
  name: "lookup_org",
  label: "查组织",
  description: "查询指定势力/组织的信息。根据声望等级进行内容分级脱敏拦截过滤。",
  parameters: Type.Object({
    orgId: Type.String({ description: "组织ID，如 'soubu_service_club', 'soubu_student_council', 'yukinoshita_family'" }),
  }),
  async execute(_id, params, _s, _o, _ctx) {
    const { orgId } = params;
    const org = gameState.organizations?.[orgId];
    if (!org) {
      return {
        content: [{ type: "text", text: `未找到组织ID为「${orgId}」的势力记录。` }],
        details: {}
      };
    }

    const rep = gameState.player.reputation?.[orgId] ?? 0;
    
    // Determine access level based on reputation
    const isCore = rep >= 4;
    const isFriendly = rep >= 1;

    let output = `# ${org.name} (声望: ${rep})\n`;
    output += `规模: ${org.scale} | 类型: ${org.type} | 阶段: ${org.lifecycle_stage || "未知"}\n`;
    output += `核心控制区: ${org.coreLocation || "未知"}\n`;
    if (org.archived) output += `⚠️ 该组织已解体消亡\n`;
    output += `\n`;

    // 1. Expose wealth/influence/cohesion
    if (isCore) {
      output += `### 势力核心参数 (Classified)\n`;
      output += `- **财力**: ${org.wealth}/100\n`;
      output += `- **社会影响力**: ${org.influence}/100\n`;
      output += `- **内部凝聚力**: ${org.cohesion}/100\n\n`;
    } else {
      output += `### 势力大致规模\n`;
      const desc = org.influence > 80 ? "大财阀/核心机关 (影响甚广)" : org.influence > 40 ? "中等规模组织" : "微型社团/圈子";
      output += `- 势力名望估值: ${desc}\n\n`;
    }

    // 2. Expose goals
    output += `### 组织宏观目标\n`;
    output += `- ${org.goals?.macroGoal || "暂无公开宏观目标"}\n\n`;

    if (isFriendly) {
      output += `### 阶段性目标 (Restricted)\n`;
      output += `- ${org.goals?.currentPhaseGoal || "暂无阶段性目标"}\n\n`;
    }

    // 3. Expose members list
    if (isFriendly) {
      output += `### 成员名单 (Restricted)\n`;
      const leaderName = org.leader || "未公开";
      output += `- **领袖**: ${leaderName}\n`;
      output += `- **成员列表**:\n`;
      for (const m of org.members || []) {
        output += `  - ${m.npcName} (职位: ${m.role}, 级别: ${m.rank})\n`;
      }
      output += `\n`;
    } else {
      output += `### 领袖\n`;
      output += `- **公开领袖**: ${org.leader || "未知"}\n\n`;
    }

    // 4. Expose facts entries based on level gating
    const visibleLevels = new Set<string>(["common", "familiar"]);
    if (isFriendly) {
      visibleLevels.add("industry");
      visibleLevels.add("close");
    }
    if (isCore) {
      visibleLevels.add("hidden");
      visibleLevels.add("intimate");
      visibleLevels.add("hidden_canonical");
    }

    const filteredEntries = (org.entries || []).filter(e => visibleLevels.has(e.level));
    
    if (filteredEntries.length > 0) {
      output += `### 势力情报与事实条目\n`;
      for (const e of filteredEntries) {
        output += `#### 【${e.tag}】(级别: ${e.level})\n`;
        output += `${e.text}\n\n`;
      }
    } else {
      output += `### 势力情报与事实条目\n`;
      output += `暂无对你公开的情报条目。提升声望可解锁更多内幕信息。\n`;
    }

    return {
      content: [{ type: "text", text: output.trim() }],
      details: { reputation: rep, entriesCount: filteredEntries.length }
    };
  }
};
