const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot');
require("dotenv").config();

const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MockAdapter = require('@bot-whatsapp/database/mock');
const path = require("path");
const fs = require("fs");
const { start } = require('repl');
const { registrationParams } = require('@whiskeysockets/baileys/lib/Socket/registration');


// AQUI EMPIZA LA FUNCION PARA INICIAR LA CONVERSACION DEL BOT CADA 24H

// Objeto para almacenar la última vez que un usuario completó una conversación
const lastConversationTimes = {};

// Tiempo de espera en milisegundos (24 horas)
//const TIMEOUT_DURATION = 24 * 60 * 60 * 1000; VERSION DE RESPUESTA EN 24 HORAS 
const TIMEOUT_DURATION = 1 * 60 * 1000; //VERSION DE RESPUESTA EN 3 MIN. PARA PRUEBAS  

// Función para verificar si un usuario puede iniciar una nueva conversación
const canStartNewConversation = (userId) => {
    const lastConversationTime = lastConversationTimes[userId];
    if (!lastConversationTime) return true;
    
    const timeSinceLastConversation = Date.now() - lastConversationTime;
    return timeSinceLastConversation >= TIMEOUT_DURATION;
};

// Función para registrar el fin de una conversación
const registerConversationEnd = (userId) => {
    lastConversationTimes[userId] = Date.now();
};


// CONTENEDOR DEL RESUMEN 
let summary = {
    nombre: '',
    numero: '',
    cargo: '',
    agrupacion: '',
    dispositivo: '',
    problema: '',
    folio: '',
    otro: ''
};


// Objeto para almacenar los temporizadores activos y el contador de recordatorios
const activeTimers = {};
const reminderCounts = {};

//FUNCION PARA MANDAR EL MENSAJE DE RECORDATORIO
const handleReminder = async (ctx, flowDynamic, gotoFlow) => {
    if (activeTimers[ctx.from]) {
        reminderCounts[ctx.from] = (reminderCounts[ctx.from] || 0) + 1;
        
        if (reminderCounts[ctx.from] === 1) {
            const result = await gotoFlow(flowRecordatorio);
            startReminderTimer(ctx, flowDynamic, gotoFlow);
            return result;
        } else if (reminderCounts[ctx.from] === 2) {
            // Segundo recordatorio
            const result = await gotoFlow(flowRecordatorio2);
            startReminderTimer(ctx, flowDynamic, gotoFlow);
            return result;
        } else {
            // Si ya se enviaron dos recordatorios, finalizar la sesión
            clearReminderTimer(ctx.from);
            return gotoFlow(flowInactividad); 
        }
    }
};/*

const handleReminder = async (ctx, flowDynamic, gotoFlow) => {
    if (activeTimers[ctx.from]) {
        reminderCounts[ctx.from] = (reminderCounts[ctx.from] || 0) + 1;
        
        if (reminderCounts[ctx.from] === 1) {
            // Primer recordatorio: enviamos mensaje sin cambiar de flujo
            await flowDynamic("¿Sigues ahí? Por favor, proporciona la información solicitada para continuar con tu caso.");
            startReminderTimer(ctx, flowDynamic, gotoFlow); // Reinicia el temporizador para el siguiente recordatorio
        } else if (reminderCounts[ctx.from] === 2) {
            // Segundo recordatorio: enviamos un segundo mensaje sin cambiar de flujo
            await flowDynamic("Si necesitas ayuda, recuerda enviar la información solicitada para que podamos asistirte.");
            startReminderTimer(ctx, flowDynamic, gotoFlow);
        } else {
            // Tercer recordatorio: finalizar sesión y redirigir a flujo de inactividad
            clearReminderTimer(ctx.from);
            return gotoFlow(flowInactividad);
        }
    }
};*/
/*
const handleReminder = async (ctx, flowDynamic, gotoFlow) => {
    if (activeTimers[ctx.from]) {
        reminderCounts[ctx.from] = (reminderCounts[ctx.from] || 0) + 1;

        if (reminderCounts[ctx.from] === 1) {
            // Primer recordatorio
            await gotoFlow(flowRecordatorio);
            startReminderTimer(ctx); // Reinicia el temporizador para el siguiente recordatorio
        } else if (reminderCounts[ctx.from] === 2) {
            // Segundo recordatorio
            await gotoFlow(flowRecordatorio2)
            startReminderTimer(ctx);
        } else {
            // Si ya se enviaron dos recordatorios, finalizar la sesión
            clearReminderTimer(ctx.from);
            await gotoFlow(flowInactividad);
        }
    }
};*/

// Función para iniciar el temporizador de recordatorio
const startReminderTimer = (ctx, flowDynamic, gotoFlow) => {

    // Limpia cualquier temporizador existente para este usuario
    if (activeTimers[ctx.from]) {
        clearTimeout(activeTimers[ctx.from]);
    }
    
    // Establece un nuevo temporizador
    activeTimers[ctx.from] = setTimeout(() => {
        //handleReminder(ctx, flowDynamic, gotoFlow);
        handleReminder(ctx, flowDynamic, gotoFlow);
    }, 1 * 30 * 1000); // minutos en milisegundos
}; 

// Función para limpiar el temporizador y contadores
const clearReminderTimer = (from) => {
    if (activeTimers[from]) {
        clearTimeout(activeTimers[from]);
        delete activeTimers[from];
        delete reminderCounts[from];
    }
};


// FUNCIÓN PARA ASIGNAR EL SALUDO DEPENDIENDO DEL HORARIO 
const getSaludo = () => {
    const hora = new Date().getHours();
    if (hora >= 1 && hora < 12) {
        return "¡Buenos días!";
    } else if (hora >= 12 && hora < 19) {
        return "¡Buenas tardes!";
    } else {
        return "¡Buenas noches!";
    }
};

// FLUJO DE BIENVENIDA 
const flowWelcome = addKeyword(EVENTS.WELCOME)
    .addAction(async(ctx, { endFlow }) => {
        if(!canStartNewConversation(ctx.from)){
            return endFlow();
        }
    })
    .addAnswer(
        [getSaludo() + "👋. Te estás comunicando con la mesa de servicio de la plataforma SCP."],
        null,
        async (ctx, { flowDynamic, gotoFlow }) => {
            // Reiniciar contadores al inicio de una nueva conversación
            clearReminderTimer(ctx.from);
            reminderCounts[ctx.from] = 0;
            startReminderTimer(ctx, flowDynamic, gotoFlow);
        }
    )
    .addAnswer(
        "Bienvenido. Por favor, proporciona los siguientes datos (*En un solo mensaje de texto*): \n- Nombre completo \n- Número de dispositivo \n- Cargo \n- Agrupación.",
        { capture: true },
        async (ctx, { gotoFlow, flowDynamic }) => {
            clearReminderTimer(ctx.from);
            
            // Limpiamos el texto de espacios extras y saltos de línea múltiples
            const cleanText = ctx.body.trim().replace(/\s+/g, ' ');
            
            // Intentamos diferentes formatos de separación
            let inputData;
            
            if (ctx.body.includes('\n')) {
                inputData = ctx.body
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);
            } else {
                inputData = cleanText
                    .split(',')
                    .map(item => item.trim())
                    .filter(item => item.length > 0);
            }

            if (inputData.length >= 4) {
                const [nombreCompleto, numeroDispositivo, cargo, agrupacion] = inputData;
                const nombreSplit = nombreCompleto.trim().split(' ');
                
                if (nombreSplit.length >= 2 && numeroDispositivo && cargo && agrupacion) {
                    
                    summary.nombre = nombreCompleto;
                    summary.numero = numeroDispositivo;
                    summary.cargo = cargo;
                    summary.agrupacion = agrupacion;
                    
                    startReminderTimer(ctx, flowDynamic, gotoFlow);
                    return gotoFlow(flowDesicion);
                }
            }
            startReminderTimer(ctx, flowDynamic, gotoFlow);
            return gotoFlow(flowValidacion);
        }
    );

// FLOW VALIDACION DE DATOS 
const flowValidacion = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
.addAnswer("Faltan datos o el formato no es correcto. Por favor ingresa todos los datos requeridos correctamente \n*Ejemplo:* \nJuan Medina Chavez \n85472 \nOficial \nTuristica", 
    { capture: true }, async (ctx, { gotoFlow, flowDynamic}) => {
        
        const cleanText = ctx.body.trim().replace(/\s+/g, ' ');
        
        let inputData;
        
        if (ctx.body.includes('\n')) {
            inputData = ctx.body
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0); 
        } else {
            inputData = cleanText
                .split(',')
                .map(item => item.trim())
                .filter(item => item.length > 0); 
        }

        if (inputData.length >= 4) {
            const [nombreCompleto, numeroDispositivo, cargo, agrupacion] = inputData;
            
            const nombreSplit = nombreCompleto.trim().split(' ');
            
            if (nombreSplit.length >= 2 && numeroDispositivo && cargo && agrupacion) {
                
                summary.nombre = nombreCompleto;               
                summary.numero = numeroDispositivo;               
                summary.cargo = cargo;               
                summary.agrupacion = agrupacion;                
                
                return gotoFlow(flowDesicion);
            }
        }
        return gotoFlow(flowValidacion2);
    }
);

// FLOW VALIDACION DE DATOS 
const flowValidacion2 = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
.addAnswer("Por favor ingresa todos los datos requeridos correctamente, de lo contrario se cerrara la sesión del ChatBot", 
    { capture: true }, async (ctx, { gotoFlow, flowDynamic}) => {
        //AQUI SE INSERTA LA FUNCION PARA LIMPIAR EL CONTADOR DE RECORDATORIO 
        const cleanText = ctx.body.trim().replace(/\s+/g, ' ');
    
        let inputData;
        
        if (ctx.body.includes('\n')) {
            inputData = ctx.body
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0); 
        } else {
            inputData = cleanText
                .split(',')
                .map(item => item.trim())
                .filter(item => item.length > 0); 
        }

        if (inputData.length >= 4) {
            const [nombreCompleto, numeroDispositivo, cargo, agrupacion] = inputData;
            
            const nombreSplit = nombreCompleto.trim().split(' ');
            
            if (nombreSplit.length >= 2 && 
                numeroDispositivo && 
                cargo && 
                agrupacion) {
                
                summary.nombre = nombreCompleto;
                summary.numero = numeroDispositivo;
                summary.cargo = cargo;
                summary.agrupacion = agrupacion;
                
                return gotoFlow(flowDesicion);
            }
        }
        return gotoFlow(flowCierre);
    }
);

// FLUJO DE PRIMERA DESICION 
const flowDesicion = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
        clearReminderTimer(ctx.from);
    })
    .addAnswer("Eliga en donde presenta el problema:\n *Selecciona un número* \n1. Equipo de computo💻 \n2. Dispositivo movil📱 \n3. Seguimiento de ticket\n4. Otro \n\nSi en cualquier momento de la conversación desea salir del chatbot, escriba *salir*", 
        { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        if (ctx.body.toLowerCase() === "1" || ctx.body.toLowerCase() === "equipo" || ctx.body.toLowerCase()==="comput") {
            summary.dispositivo = "Equipo de cómputo";
            return gotoFlow(flowWorkstation);
        } else if (ctx.body.toLowerCase() === "2" || ctx.body.toLowerCase() === "dispositivo" || ctx.body.toLowerCase()==="movil") {
            summary.dispositivo = "Dispositivo movil";
            return gotoFlow(flowPointMovil);
        } else if (ctx.body.toLowerCase() === "3" || ctx.body.toLowerCase() === "seguimiento" || ctx.body.toLowerCase()==="ticket") {
            return gotoFlow(flowSeguimiento);
        } else if (ctx.body==="4" || ctx.body.toLowerCase()==="otro"){
            return gotoFlow(flowOtros);
        } else if(ctx.body.toLowerCase()==="salir"){
            return gotoFlow(flowSalida);
        } else {
            await flowDynamic("Por favor selecciona una opción válida (1, 2, 3 o 4).");
            return gotoFlow(flowDesicion);
        }
    });

// FLOW DE WORKSTATION 
const flowWorkstation = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
    })
    .addAnswer("¿Cual es el problema que presenta en el equipo de computo?")
    .addAnswer("Especifica el tipo de problema: \n1. Software(*programas o aplicaciones*) \n2. Hardware(*problema fisco*) \n3. Regresar", 
        { capture: true }, async (ctx,{ gotoFlow, flowDynamic }) => {
            
        if (ctx.body==="1") {
            return gotoFlow(flowMenuWS);
        } else if (ctx.body==="2") {
            return gotoFlow(flowMenuWH);
        } else if (ctx.body === "3" || ctx.body.toLowerCase().includes("regresar")){
            return gotoFlow(flowDesicion);
        } else if(ctx.body==="salir"){
            return gotoFlow(flowSalida); 
        } else {
            await flowDynamic("Respuesta no válida. Especifica si el problema es de software(1) o hardware(2).");
            return gotoFlow(flowWorkstation);
        }
    });

// FLOW DE POINTMOVIL 
const flowPointMovil = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("¿Cuál es el problema con el dispositivo movil?")
    .addAnswer("Especifica el tipo de problema:\n1. Software(*aplicaciones*)\n2. Hardware(*problema fisico*) \n3. Regresar", 
        { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        
        if (ctx.body === "1") {
            return gotoFlow(flowMenuPS);
        } else if (ctx.body === "2") {
            return gotoFlow(flowMenuPH);
        } else if (ctx.body === "3" || ctx.body.toLowerCase().includes("regresar")){
            return gotoFlow(flowDesicion);
        } else if(ctx.body.toLowerCase()==="salir"){
            return gotoFlow(flowSalida);
        } else {
            await flowDynamic("Respuesta no válida. Especifica si el problema es de software(1) o hardware(2).");
            return gotoFlow(flowPointMovil);
        }
    });

// FLOW DE SEGUIMIENTO 
const flowSeguimiento = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("¿Tiene un folio de seguimiento? \n1. Si \n2. No \n3. Regresar", 
        { capture: true }, async (ctx, { gotoFlow,flowDynamic }) => {
        
        if (ctx.body.toLowerCase().includes("si") || ctx.body==="1") {
            return gotoFlow(flowTicket);
        } else if (ctx.body.toLowerCase().includes("no") || ctx.body==="2") {
            return gotoFlow(flowSummaryNoFolio);
        } else if (ctx.body.toLowerCase().includes("regresar") || ctx.body==="3"){
            return gotoFlow(flowDesicion);
        } else if(ctx.body.toLowerCase()==="salir"){
            return gotoFlow(flowSalida);
        } else {
            await flowDynamic("Respuesta inválida. Elige una opción (1,2 o 3).");
            return gotoFlow(flowSeguimiento);
        }
    });

//FLUJO DE VALIDACION DE TICKET
const flowTicket = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    
    clearReminderTimer(ctx.from);
})
    .addAnswer("Ingresa el folio de seguimiento (debe ser de 6 dígitos) \nSi desea ir al menú anterior, escriba *regresar*", 
        { capture: true }, async (ctx, { gotoFlow, flowDynamic}) => {
        
        summary.folio = ctx.body;
        const folioValido = /^\d{6}$/; // FORMATO DE VALIDACION DE FOLIO 
        if (folioValido.test(ctx.body)) {
            await flowDynamic("Formato de folio correcto.")
            return gotoFlow(flowSummaryFolio);
        } else if(ctx.body.toLowerCase().includes("regresar")){
            return gotoFlow(flowSeguimiento);
        } else if(ctx.body.toLowerCase()==="salir"){
            return gotoFlow(flowSalida);
        } else {
            await flowDynamic("Error, formato incorrecto. Un folio contiene 6 digitos");
            return gotoFlow(flowTicket);
        }
    });

// FLOW DE PROBLEMAS CON SOFTWARE WORKSTATION
const flowMenuWS = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Eliga el inconveniente presentado: \n1. Actualizacion de aplicaciones \n2. Contratiempo con SCP \n3. Solicitud de credenciales \n4. Otro \n5. Regresar",
    { capture: true }, async (ctx, {gotoFlow, flowDynamic}) => {
        
        if(ctx.body === "1"){
            summary.problema = "Actualización de aplicaciones";
            return gotoFlow(flowEvidenciaSummary);
        } else if(ctx.body === "2"){
            summary.problema = "Contratiempo con SCP"; 
            return gotoFlow(flowEvidenciaSummary); // ACA IBA EL FLOW USUARIO, QUEDA PENDIENTE REVISION 
        } else if (ctx.body === "3"){
            summary.problema = "Solicitud de credenciales";
            return gotoFlow(flowAccesos);
        } else if (ctx.body === "4"){
            return gotoFlow(flowOtrosSummary)
        } else if (ctx.body==="5"){
            return gotoFlow(flowWorkstation);
        } else if(ctx.body.toLowerCase()==="salir"){
            return gotoFlow(flowSalida);
        } else {
            await flowDynamic("Opción no válida. Elige un número del 1 al 5.");
            return gotoFlow(flowMenuWS);
        }
    });

/*/ FLOW DE SOLICITUD DE USUARIO 
const flowUsuario = addKeyword(EVENTS.ACTION)
    .addAnswer("Ingrese el usuario del equipo de computo \nSi desea ir al menú anterior, escriba *regresar*", 
    { capture: true}, async ({gotoFlow, flowDynamic}) => {
        
        if(ctx.body.toLowerCase()==="salir"){
            await checkExitCommand(ctx, { gotoFlow });
        } else if(ctx.body.toLowerCase().includes("regresar")){
            return gotoFlow(flowSeguimiento); 
        } else {
            return gotoFlow(flowEvidenciaSummary);
        }
    });*/

//FLOW SOLICITUD DE ACCESOS
const flowAccesos = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Favor de ingresar los siguietes datos(*En un solo mensaje de texto*): \n- Usuario \n- Numero de equipo de computo \n Ubicacion \n\nSi desea ir al menú anterior, escriba *regresar*", 
    { capture: true}, async (ctx, {gotoFlow}) => {
        
        if(ctx.body.toLowerCase()==="salir"){
            return gotoFlow(flowSalida);
        } else if(ctx.body.toLowerCase().includes("regresar")){
            return gotoFlow(flowMenuWS); 
        } else {
            return gotoFlow(flowSummary);
        } 
    });

// FLOW DE PROBLEMAS CON HARDWARE WORKSTATION 
const flowMenuWH = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Eliga el detalle presentado: \n1. Instalación de equipo de computo \n2. Rehubicacion de equipo de computo \n3. Inconveniente con componentes \n4. Otro \n5. Regresar",
    { capture: true }, async (ctx, {gotoFlow, flowDynamic}) => {
        
        if (ctx.body === "1"){
            summary.problema = "Instalación de equipo de computo";
            return gotoFlow(flowInstalacion);
        } else if (ctx.body === "2"){
            summary.problema = "Rehubicación de equipo de computo";
            return gotoFlow(flowRehubicaion);
        } else if (ctx.body === "3"){
            return gotoFlow(flowComponentes);
        } else if(ctx.body === "4"){
            return gotoFlow(flowOtrosSummary);
        } else if(ctx.body==="5"){
            return gotoFlow(flowWorkstation);
        } else if(ctx.body.toLowerCase()==="salir"){
            return gotoFlow(flowSalida);
        } else {
            await flowDynamic("Opción no válida. Elige un número del 1 al 5.");
            return gotoFlow(flowMenuWH);
        }
    });

// FLOW DE INSTALACION 
const flowInstalacion = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Ingrese el numero de serie y la ubicacion \nSi desea ir al menú anterior, escriba *regresar*", 
        { capture: true}, async (ctx, { gotoFlow, flowDynamic}) => {
            
            if(ctx.body.toLowerCase()==="salir"){
                return gotoFlow(flowSalida);
            } else if(ctx.body.toLowerCase().includes("regresar")){
                return gotoFlow(flowMenuWH); 
            } else {
                return gotoFlow(flowSummary);
            }
        });

// FLOW DE INSTALACION 
const flowRehubicaion = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Ingrese el numero de serie, ubicacion actual y la nueva ubicacion \nSi desea ir al menú anterior, escriba *regresar*", 
        { capture: true}, async (ctx, { gotoFlow, flowDynamic}) => {
            
            if(ctx.body.toLowerCase()==="salir"){
                return gotoFlow(flowSalida);
            } else if(ctx.body.toLowerCase().includes("regresar")){
                return gotoFlow(flowMenuWH); 
            } else {
                return gotoFlow(flowSummary);
            }
        });

// FLOW DE COMPONENTES 
const flowComponentes = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Eliga el componente donde presenta el incoveniente: \n1. Diadema \n2. Cable HDMI \n3. Monitor \n4. Mouse \n5. Teclado \n6. No break \n7. Otro \n8. Regresar",
        {capture: true}, async (ctx, {gotoFlow, flowDynamic}) => {
            
            if (ctx.body === "1"){
                summary.problema = "Diadema";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "2"){
                summary.problema = "Cable HDMI";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "3"){
                summary.problema = "Monitor";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "4"){
                summary.problema === "Mouse";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "5"){
                summary.problema = "Teclado"
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "6"){
                summary.problema = "No break";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "7"){
                return gotoFlow(flowOtrosSummary)
            } else if(ctx.body==="8"){
                return gotoFlow(flowMenuWH);
            } else if(ctx.body.toLowerCase()==="salir"){
                return gotoFlow(flowSalida); 
            } else {
                await flowDynamic("Opción no válida. Elige un número del 1 al 8.");
                return gotoFlow(flowComponentes);
            }
        });

// FLOW MENU POINTMOVIL SOFTWARE.
const flowMenuPS = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Elige el inconveniente presentado: \n1. Contratiempo con SCP \n2. Contratiempo con PTT \n3. Problema de red \n4. Solicitar frecuencia \n5. Otro \n6. Regresar",
        { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
            
            if (ctx.body === "1") {
                summary.problema = "Contratiempo con SCP";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "2"){
                summary.problema = "Contratiempo con PTT";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "3"){
                summary.problema = "Problema de red";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "4") {
                summary.problema = "Solicitar frecuencia";
                return gotoFlow(flowSoliCanal);
            } else if (ctx.body === "5") { 
                return gotoFlow(flowOtrosSummary); 
            } else if (ctx.body === "6"){ 
                return gotoFlow(flowPointMovil); 
            } else if(ctx.body.toLowerCase()==="salir"){
                return gotoFlow(flowSalida);
            } else {
                await flowDynamic("Opción no válida. Elige un número del 1 al 6.");
                return gotoFlow(flowMenuPS);
            }
        });

//FLOW SOLICITUD DE CANAL 
const flowSoliCanal = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
        .addAnswer("Especificar el canal requerido", 
            { capture: true}, async (ctx, {gotoFlow, flowDynamic}) => {
            return gotoFlow(flowEvidenciaSummary)
        });

// FLOW MENU POINTMOVIL HARDWARE.
const flowMenuPH = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Elige el tipo de problema presentado: \n1. Contratiempo con accesorios \n2. Daño en dispositivo \n3. Robo o extravío \n4. Otro \n5. Regresar",
        { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
            
            if (ctx.body === "1") {
                return gotoFlow(flowAccesorios);
            } else if (ctx.body === "2") {
                return gotoFlow(flowDanos);
            } else if (ctx.body === "3") { 
                summary.problema = "Robo o extravío";
                await flowDynamic("Buen dia, de acuerdo con el extravió de dispositivo se procede a generar un folio de seguimiento, para seguir brindándole la atención es necesario comparta una ficha informativa con los siguientes datos:\n•Nombre y fecha.\n•Agrupación.\n•Descripción de los acontecimientos.\n•Número de dispositivo y número de serie.\n•Nombre y firma.\n•Membretada y con firma de un superior.\n\nLa ficha informativa deberá ser enviada al correo: mesadeservicio@sysne.com.mx")
                return gotoFlow(flowSummary);
            } else if (ctx.body === "4"){
                return gotoFlow(flowOtrosSummary);
            } else if (ctx.body === "5"){
                return gotoFlow(flowPointMovil);
            } else if(ctx.body.toLowerCase()==="salir"){
                return gotoFlow(flowSalida); 
            } else {
                await flowDynamic("Opción no válida. Elige un número del 1 al 5.");
                return gotoFlow(flowMenuPH);
            }
        });

// FLOW MENU DE ACCESORIOS
const flowAccesorios = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("¿En qué accesorio presenta el problema?\n1. Cable USB\n2. Tapas\n3. Baterías\n4. Cargador\n5. Arnés\n6. Otro\n7. Regresar",
        { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
            
            if (ctx.body === "1") {
                summary.problema = "Cable USB";
                return gotoFlow(flowEvidenciaSummary); 
            } else if(ctx.body === "2"){
                summary.problema = "Tapa";
                return gotoFlow(flowEvidenciaSummary);
            } else if(ctx.body === "3"){
                summary.problema = "Batería";
                return gotoFlow(flowEvidenciaSummary);
            } else if(ctx.body === "4"){
                summary.problema = "Cargador";
                return gotoFlow(flowEvidenciaSummary);
            } else if(ctx.body === "5"){
                summary.problema = "Arnés";
                return gotoFlow(flowEvidenciaSummary);
            }
            else if(ctx.body === "6"){
                return gotoFlow(flowOtrosSummary);
            } else if(ctx.body === "7"){
                return gotoFlow(flowMenuPH);
            } else if(ctx.body.toLowerCase()==="salir"){
                return gotoFlow(flowSalida); 
            } else{
                await flowDynamic("Ingrese una opción correcta. Elige un número del 1 al 7.");
                return gotoFlow(flowAccesorios);
            }
        });

// FLOW DAÑOS 
const flowDanos = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Elija una de las siguientes opciones: \n1. Mantenimiento \n2. Daño en pantalla \n3. Daño en botones \n4. Reparación de engomado \n5. Cambio de mica \n6. Escáner \n7. Otro \n8. Regresar",
        { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
            
            if (ctx.body === "1") {
                summary.problema = "Mantenimiento";
                return gotoFlow(flowEvidenciaSummary); 
            } else if(ctx.body === "2"){
                summary.problema = "Daño en pantalla";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "3"){
                summary.problema = "Daño en botones";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "4"){
                summary.problema = "Reparación de engomado";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "5"){
                summary.problema = "Cambio de mica";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "6"){
                summary.problema = "Escaner";
                return gotoFlow(flowEvidenciaSummary);
            } else if (ctx.body === "7") {;
                return gotoFlow(flowOtrosSummary);
            } else if (ctx.body==="8"){
                return gotoFlow(flowMenuPH);
            } else if(ctx.body.toLowerCase()==="salir"){
                return gotoFlow(flowSalida); 
            } else {
                await flowDynamic("Ingrese una opción valida. Elige un número del 1 al 8");
                return gotoFlow(flowDanos);
            }
    });

//FLOW OTROS 
const flowOtros = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Favor de especificar el incoveniente", 
        { capture: true}, async (ctx, {gotoFlow, flowDynamic}) => {
        summary.otro = ctx.body;    
        return gotoFlow(flowSummaryExten); //FLOW DESPEDIDA, SOLO POR PROBAR 
    }); 
const flowOtrosSummary = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Favor de especificar el inconveniente", 
        { capture: true}, async (ctx, {gotoFlow, flowDynamic}) => {
        summary.problema = ctx.body;
        return gotoFlow(flowSummary);
    });

//FLOW SOLICITUD DE EVIDENCIA 
const flowEvidencia = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Favor de enviar la evidencia 📸", 
        { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        return gotoFlow(flowDespedida); 
    });
const flowEvidenciaSummary = addKeyword(EVENTS.ACTION)
.addAction(async(ctx) => {
    clearReminderTimer(ctx.from);
})
    .addAnswer("Favor de enviar la evidencia 📸",
        { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        return gotoFlow(flowSummary); 
    });

// FLOW DE SALIDA 
const flowSalida = addKeyword(EVENTS.ACTION)
    .addAnswer("Usted finalizo la sesión del ChatBot🤖, en un momento un agente se comunicará",
        null, 
        async (ctx) => {
            clearReminderTimer(ctx.from);
            registerConversationEnd(ctx.from);
        });

// FLOW DE SALIDA POR INACTIVIDAD
const flowInactividad = addKeyword(EVENTS.ACTION)
.addAnswer("❌ La sesión a finalizado por inactividad, espera a que un agente te contacte, gracias!",
    null,
    async(ctx) => {
        clearReminderTimer(ctx.from);
        registerConversationEnd(ctx.from);
    }); 

//FLOW RECORDATORIO
const flowRecordatorio = addKeyword(EVENTS.ACTION)
    .addAnswer("⚠️ ¿Sigues ahí? Por favor, proporciona la información solicitada para continuar con tu caso.");
const flowRecordatorio2 = addKeyword(EVENTS.ACTION)
    .addAnswer("⚠️ Si necesitas ayuda, recuerda enviar la información solicitada para que podamos asistirte.")

// FLOW DESPEDIDA
const flowDespedida = addKeyword(EVENTS.ACTION)
    .addAnswer("Gracias, en un momento un agente se comunicará para dar seguimiento.",
        null,
        async (ctx) => {
            clearReminderTimer(ctx.from);
            registerConversationEnd(ctx.from);
        });

//FLOW DE CIERRE POR INTENTOS FALLIDOS
const flowCierre = addKeyword(EVENTS.ACTION)
    .addAnswer("❌ La sesión a finalizado por demasiados intentos fallidos, en un momento un agente lo contactara, gracias!",
        null, 
        async(ctx) => {
            clearReminderTimer(ctx.from);
            registerConversationEnd(ctx.from);
        });

// FLUJO PARA VER EL RESUMEN DE LA CONVERSACIÓN
const flowSummary = addKeyword(EVENTS.ACTION)
.addAnswer("Gracias, en un momento un agente se comunicará para dar seguimiento.",
    null,
    async (ctx, { flowDynamic }) => {
        clearReminderTimer(ctx.from);
        registerConversationEnd(ctx.from);
        await flowDynamic(
            [
                { body: `Se recibe una solicitud de soporte vía WhatsApp por parte de ${summary.nombre}, cargo ${summary.cargo} de la agrupación ${summary.agrupacion} con dispositivo ${summary.numero} indicando inconveniente con ${summary.dispositivo}, relacionado con ${summary.problema}.` }
            ]
        );
    }
);
const flowSummaryFolio = addKeyword(EVENTS.ACTION)
.addAnswer("Gracias, en un momento un agente se comunicará para dar seguimiento.",
    null,
    async (ctx, { flowDynamic }) => {
        clearReminderTimer(ctx.from);
        registerConversationEnd(ctx.from);
        await flowDynamic(
            [
                { body: `Se recibe una solicitud de soporte vía WhatsApp por parte de ${summary.nombre}, cargo ${summary.cargo} de la agrupación ${summary.agrupacion} con dispositivo ${summary.numero} para dar seguimiento a su ticket *${summary.folio}*` }
            ]
        );
    }
);
const flowSummaryNoFolio = addKeyword(EVENTS.ACTION)
.addAnswer("Gracias, en un momento un agente se comunicará para dar seguimiento.",
    null,
    async (ctx, { flowDynamic }) => {
        clearReminderTimer(ctx.from);
        registerConversationEnd(ctx.from);
        await flowDynamic(
            [
                { body: `Se recibe una solicitud de soporte vía WhatsApp por parte de ${summary.nombre}, cargo ${summary.cargo} de la agrupación ${summary.agrupacion} con dispositivo ${summary.numero} para dar seguimiento a su ticket` }
            ]
        );
    }
);
const flowSummaryExten = addKeyword(EVENTS.ACTION)
.addAnswer("Gracias, en un momento un agente se comunicará para dar seguimiento.",
    null,
    async (ctx, {flowDynamic}) => {
        clearReminderTimer(ctx.from);
        registerConversationEnd(ctx.from);
        await flowDynamic(
            [
                {body: `Se recibe una solicitud de soporte vía WhatsApp por parte de ${summary.nombre}, cargo ${summary.cargo} de la agrupación ${summary.agrupacion} con dispositivo ${summary.numero} presentando el siguiente inconveniente:`},
                {body: `${summary.otro}`}
            ]
        );
    }
)

// CONFIGURACION DEL BOT
const main = async () => {
    const adapterDB = new MockAdapter() 
    const adapterFlow = createFlow([
        flowWelcome, 
        flowValidacion,
        flowValidacion2,
        flowDesicion, 
        flowWorkstation, 
        flowPointMovil, 
        flowSeguimiento, 
        flowTicket, 
        flowMenuWS,
       // flowUsuario, QUEDA PENDIENTE LA AGREGACION DE ESTE FLUJO, QUEDA A REVISION
        flowAccesos,
        flowMenuWH, 
        flowInstalacion,
        flowRehubicaion,
        flowComponentes,
        flowMenuPS, 
        flowSoliCanal,
        flowMenuPH, 
        flowAccesorios, 
        flowDanos, 
        flowOtros, 
        flowOtrosSummary,
        flowEvidencia, 
        flowEvidenciaSummary,
        flowSalida,
        flowInactividad, 
        flowRecordatorio,
        flowRecordatorio2,
        flowCierre,
        flowDespedida,
        flowSummary,
        flowSummaryFolio,
        flowSummaryNoFolio,
        flowSummaryExten]) 

    const adapterProvider = createProvider(BaileysProvider)

    createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    QRPortalWeb()
}

main();