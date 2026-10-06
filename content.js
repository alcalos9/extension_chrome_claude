// Escuchamos los mensajes que provienen de la interfaz de la extensión (popup.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getChatContent") {
    const chatData = extractChat();
    sendResponse({ chat: chatData });
  }
});

function extractChat() {
  const messages = [];
  
  // Dado que Claude actualiza su DOM frecuentemente, implementaremos múltiples estrategias
  
  // Estrategia 1: Buscar por atributos genéricos de mensajes de Claude (pueden variar según la versión)
  // Claude suele usar elementos de grid y flex con ciertas clases para el hilo
  const potentialMessages = document.querySelectorAll('.font-user-message, .font-claude-message');
  
  if (potentialMessages.length > 0) {
    potentialMessages.forEach(el => {
      const isUser = el.className.includes('user');
      messages.push({
        role: isUser ? 'User' : 'Claude',
        content: el.innerText
      });
    });
    return messages;
  }

  // Estrategia 2: Heurística buscando bloques dentro de la etiqueta main que parezcan mensajes
  const mainChatContainer = document.querySelector('main, .flex-1.flex.flex-col, .overflow-y-auto');
  if (mainChatContainer) {
    // Buscar elementos hijos que contengan texto sustancial
    // En las UI modernas, cada burbuja de chat está usualmente en un wrapper div a nivel superior
    // Vamos a buscar bloques que puedan ser mensajes basados en la presencia de imágenes de avatar o formato alternado.
    
    // Simplificación como "fallback" general si las clases específicas fallan
    messages.push({
      role: 'Chat (Raw)',
      content: mainChatContainer.innerText
    });
    return messages;
  }
  
  // Estrategia 3: Captura de todo el texto de la página si nada más funciona
  messages.push({
    role: 'System',
    content: 'No se pudo aislar el chat específicamente. Todo el texto detectado:\n\n' + document.body.innerText.substring(0, 500) + '...'
  });

  return messages;
}
