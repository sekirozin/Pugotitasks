const Alexa = require("ask-sdk-core");
const express = require("express");
const { ExpressAdapter } = require("ask-sdk-express-adapter");
const api = require("./api");

const port = Number(process.env.PORT || 3011);
const configuredSkillId = process.env.ALEXA_SKILL_ID || "";

function accessToken(handlerInput) {
  return handlerInput.requestEnvelope.context?.System?.user?.accessToken
    || handlerInput.requestEnvelope.session?.user?.accessToken
    || "";
}

function requireLinkedAccount(handlerInput) {
  if (accessToken(handlerInput)) return null;
  return handlerInput.responseBuilder
    .speak("Conecte sua conta PugotiLab no aplicativo Alexa para acessar suas tarefas.")
    .withLinkAccountCard()
    .getResponse();
}

function slotValue(handlerInput, name) {
  return String(Alexa.getSlotValue(handlerInput.requestEnvelope, name) || "").trim();
}

function normalizeText(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function spokenList(tasks, label) {
  if (!tasks.length) return `Você não tem tarefas ${label}.`;
  const visible = tasks.slice(0, 5);
  const titles = visible.map((task, index) => `${index + 1}, ${task.title}`);
  const remaining = tasks.length - visible.length;
  return `Você tem ${tasks.length} ${tasks.length === 1 ? "tarefa" : "tarefas"} ${label}: ${titles.join("; ")}.${remaining > 0 ? ` E mais ${remaining}.` : ""}`;
}

const SkillIdInterceptor = {
  process(handlerInput) {
    if (!configuredSkillId) return;
    const applicationId = handlerInput.requestEnvelope.context?.System?.application?.applicationId
      || handlerInput.requestEnvelope.session?.application?.applicationId;
    if (applicationId !== configuredSkillId) throw new Error("Skill ID inválido.");
  }
};

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest";
  },
  handle(handlerInput) {
    const linked = requireLinkedAccount(handlerInput);
    if (linked) return linked;
    return handlerInput.responseBuilder
      .speak("Pugotitasks aberto. Você pode perguntar pelas tarefas de hoje, pendentes ou atrasadas.")
      .reprompt("O que deseja consultar?")
      .getResponse();
  }
};

function listIntentHandler(intentName, filter, label) {
  return {
    canHandle(handlerInput) {
      return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
        && Alexa.getIntentName(handlerInput.requestEnvelope) === intentName;
    },
    async handle(handlerInput) {
      const linked = requireLinkedAccount(handlerInput);
      if (linked) return linked;
      const result = await api.getTasks(accessToken(handlerInput), filter);
      return handlerInput.responseBuilder.speak(spokenList(result.tasks || [], label)).getResponse();
    }
  };
}

const TodayTasksIntentHandler = listIntentHandler("TodayTasksIntent", "today", "para hoje");
const PendingTasksIntentHandler = listIntentHandler("PendingTasksIntent", "pending", "pendentes");
const OverdueTasksIntentHandler = listIntentHandler("OverdueTasksIntent", "overdue", "atrasadas");

function addIntentHandler(intentName, today) {
  return {
    canHandle(handlerInput) {
      return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
        && Alexa.getIntentName(handlerInput.requestEnvelope) === intentName;
    },
    async handle(handlerInput) {
      const linked = requireLinkedAccount(handlerInput);
      if (linked) return linked;
      const title = slotValue(handlerInput, "taskTitle");
      if (!title) {
        return handlerInput.responseBuilder.speak("Não entendi o nome da tarefa.").reprompt("Qual tarefa deseja adicionar?").getResponse();
      }
      const dueAt = today ? new Date().toLocaleDateString("en-CA", { timeZone: "America/Maceio" }) : undefined;
      await api.createTask(accessToken(handlerInput), { title, ...(dueAt ? { dueAt } : {}) });
      return handlerInput.responseBuilder.speak(`Tarefa ${title} adicionada${today ? " ao seu dia" : ""}.`).getResponse();
    }
  };
}

const AddTaskIntentHandler = addIntentHandler("AddTaskIntent", false);
const AddTodayTaskIntentHandler = addIntentHandler("AddTodayTaskIntent", true);

const CompleteTaskIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
      && Alexa.getIntentName(handlerInput.requestEnvelope) === "CompleteTaskIntent";
  },
  async handle(handlerInput) {
    const linked = requireLinkedAccount(handlerInput);
    if (linked) return linked;
    const requestedTitle = slotValue(handlerInput, "taskTitle");
    if (!requestedTitle) return handlerInput.responseBuilder.speak("Não entendi qual tarefa deve ser concluída.").getResponse();
    const result = await api.getTasks(accessToken(handlerInput), "pending");
    const normalized = normalizeText(requestedTitle);
    const task = (result.tasks || []).find((item) => normalizeText(item.title) === normalized)
      || (result.tasks || []).find((item) => normalizeText(item.title).includes(normalized));
    if (!task) return handlerInput.responseBuilder.speak(`Não encontrei a tarefa ${requestedTitle}.`).getResponse();
    await api.completeTask(accessToken(handlerInput), task.id);
    return handlerInput.responseBuilder.speak(`Tarefa ${task.title} concluída.`).getResponse();
  }
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
      && Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.HelpIntent";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("Você pode perguntar quais são suas tarefas de hoje, pedir as tarefas atrasadas, adicionar uma tarefa ou concluir uma tarefa.")
      .reprompt("O que deseja fazer?")
      .getResponse();
  }
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    const intent = Alexa.getIntentName(handlerInput.requestEnvelope);
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
      && (intent === "AMAZON.CancelIntent" || intent === "AMAZON.StopIntent");
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak("Até mais.").getResponse();
  }
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
      && Alexa.getIntentName(handlerInput.requestEnvelope) === "AMAZON.FallbackIntent";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak("Não entendi. Tente perguntar pelas tarefas de hoje.").reprompt("O que deseja fazer?").getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === "SessionEndedRequest";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  }
};

const ErrorHandler = {
  canHandle() { return true; },
  handle(handlerInput, error) {
    console.error("Falha ao processar pedido da Alexa:", error);
    if (error?.status === 401) {
      return handlerInput.responseBuilder
        .speak("A conexão com sua conta expirou. Vincule novamente a conta PugotiLab no aplicativo Alexa.")
        .withLinkAccountCard()
        .getResponse();
    }
    return handlerInput.responseBuilder.speak("Não consegui acessar o Pugotitasks agora. Tente novamente em instantes.").getResponse();
  }
};

const skill = Alexa.SkillBuilders.custom()
  .addRequestInterceptors(SkillIdInterceptor)
  .addRequestHandlers(
    LaunchRequestHandler,
    TodayTasksIntentHandler,
    PendingTasksIntentHandler,
    OverdueTasksIntentHandler,
    AddTaskIntentHandler,
    AddTodayTaskIntentHandler,
    CompleteTaskIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .create();

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok" }));
const adapter = new ExpressAdapter(skill, true, true);
app.post("/alexa", adapter.getRequestHandlers());

if (require.main === module) {
  app.listen(port, "0.0.0.0", () => console.log(`Pugotitasks Alexa Skill escutando na porta ${port}`));
}

module.exports = { app, skill, normalizeText, spokenList };
