let currentChatData = null;
let currentChatTitle = "claude_chat";
let currentImageAssets = null;
let currentFileAssets = {}; // URLs extraídas por el robot

document.getElementById('refresh-btn').addEventListener('click', () => {
  const chatContainer = document.getElementById('chat-container');
  chatContainer.innerHTML = '<div class="message System">Recolectando historial (puede tardar un poco)...</div>';
  document.getElementById('export-btn').style.display = 'none';
  document.getElementById('robot-btn').style.display = 'none';
  currentFileAssets = {}; // Reiniciar

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];

    if (!activeTab.url.includes("claude.ai")) {
      chatContainer.innerHTML = '<div class="message System">⚠️ Esta extensión solo funciona en claude.ai</div>';
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      world: 'MAIN',
      func: extractChatFromPage,
    }, (results) => {
      chatContainer.innerHTML = ''; 

      if (chrome.runtime.lastError) {
         chatContainer.innerHTML = `<div class="message System">❌ Error: ${chrome.runtime.lastError.message}</div>`;
         return;
      }

      if (results && results[0] && results[0].result) {
        const resultData = results[0].result;
        const chat = resultData.messages;
        
        if (chat.length === 0) {
            chatContainer.innerHTML = '<div class="message System">No se detectaron mensajes válidos. Si el chat es muy largo, haz scroll hasta arriba primero.</div>';
            return;
        }

        currentChatData = chat;
        let safeTitle = resultData.title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase();
        if (safeTitle.startsWith('claude_')) safeTitle = safeTitle.substring(7);
        if (!safeTitle) safeTitle = "chat";
        currentChatTitle = safeTitle;
        currentImageAssets = resultData.imageAssets;

        document.getElementById('export-btn').style.display = 'block';
        // Mostrar siempre el botón del robot como paso 2 opcional
        document.getElementById('robot-btn').style.display = 'block';

        chat.forEach(msg => {
          const msgDiv = document.createElement('div');
          msgDiv.className = `message ${msg.role.split(' ')[0]}`;

          const roleDiv = document.createElement('div');
          roleDiv.className = 'role';
          roleDiv.textContent = msg.role === 'Claude' ? 'Claude' : 'Tú';

          const contentDiv = document.createElement('div');
          contentDiv.className = 'content';
          contentDiv.innerHTML = msg.content;

          msgDiv.appendChild(roleDiv);
          msgDiv.appendChild(contentDiv);
          chatContainer.appendChild(msgDiv);
        });
        
        chatContainer.scrollTop = chatContainer.scrollHeight;
      } else {
        chatContainer.innerHTML = '<div class="message System">No se pudo obtener el contenido del chat.</div>';
      }
    });
  });
});

document.getElementById('robot-btn').addEventListener('click', () => {
    const btn = document.getElementById('robot-btn');
    btn.innerText = "Robot extrayendo (No toques nada)...";
    btn.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          world: 'MAIN',
          func: scanAttachmentsRobot
        }, (results) => {
          btn.innerText = "2. Archivos Extraídos ✓";
          if (results && results[0] && results[0].result) {
              Object.assign(currentFileAssets, results[0].result);
              let count = Object.keys(results[0].result).length;
              if (count === 0) btn.innerText = "2. No se encontraron PDFs (Robot)";
          }
        });
    });
});

// ESTA FUNCIÓN SE EJECUTA EN LA PÁGINA (ROBOT DE CLICS GLOBAL)
async function scanAttachmentsRobot() {
    let foundUrls = {};
    
    // Buscar todos los botones que parezcan archivos (ignorando los de UI de Claude)
    let allButtons = Array.from(document.querySelectorAll('button, [role="button"], .group'));
    
    let chips = allButtons.filter(btn => {
        if (!btn.innerText) return false;
        let text = btn.innerText.toLowerCase();
        if (text.includes('editar') || text.includes('dijiste:') || text.includes('copiar')) return false;
        // Identificadores de archivos adjuntos
        return text.includes('pdf') || text.includes('csv') || text.match(/\b(kb|mb)\b/i);
    });

    // Quitar duplicados por jerarquía
    chips = chips.filter(node => !chips.some(p => p !== node && p.contains(node)));

    let fileCounter = 1;

    for (let chip of chips) {
        let chipText = chip.innerText.split('\n')[0].trim().replace(/[^a-z0-9]/gi, '_');
        if (!chipText || chipText.length > 30) chipText = `documento_${fileCounter}`;
        
        chip.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 800)); // Esperar scroll
        chip.click();
        
        // Esperar 2.5 segundos para que la ventana cargue su contenido de red
        await new Promise(r => setTimeout(r, 2500));
        
        // Buscar botón de descarga
        let downloadBtns = Array.from(document.querySelectorAll('a, button')).filter(el => {
            let text = el.innerText ? el.innerText.trim().toLowerCase() : '';
            return text === 'descargar' || text === 'download' || el.innerHTML.includes('Download');
        });
        
        if (downloadBtns.length > 0) {
            let dBtn = downloadBtns[0];
            let fileUrl = null;
            if (dBtn.href) {
                fileUrl = dBtn.href;
            } else {
                let a = dBtn.closest('a') || dBtn.querySelector('a');
                if (a && a.href) fileUrl = a.href;
            }
            
            if (fileUrl) {
                let ext = 'pdf'; // Por defecto
                if (chipText.toLowerCase().includes('csv')) ext = 'csv';
                if (chipText.toLowerCase().includes('xls')) ext = 'xlsx';
                if (fileUrl.toLowerCase().includes('.pdf')) ext = 'pdf';
                
                // Extraer el nombre real de la ventana emergente si es posible
                let modalTitle = document.querySelector('[role="dialog"] h2, [role="dialog"] h3');
                if (modalTitle && modalTitle.innerText && modalTitle.innerText.includes('.')) {
                    let candidate = modalTitle.innerText.trim().replace(/[^a-z0-9\.]/gi, '_');
                    if (candidate.length < 50) {
                        chipText = candidate.split('.')[0];
                        ext = candidate.split('.').pop();
                    }
                }
                
                foundUrls[`${chipText}.${ext}`] = fileUrl;
                fileCounter++;
            }
        }
        
        // Cerrar modal
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        await new Promise(r => setTimeout(r, 1000));
    }
    return foundUrls;
}


document.getElementById('export-btn').addEventListener('click', async () => {
    if (!currentChatData || currentChatData.length === 0) return;

    const btn = document.getElementById('export-btn');
    btn.innerText = "Descargando medios y generando ZIP...";
    btn.disabled = true;

    try {
        const zip = new JSZip();
        const folderName = currentChatTitle;
        const folder = zip.folder(folderName);
        
        const cleanChatData = currentChatData.map(msg => {
            let cleanHTML = msg.content;
            cleanHTML = cleanHTML.replace(/<img src="[^"]+" data-filename="([^"]+)"[^>]*>/gi, '<img src="$1">');
            
            let rawText = msg.content
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<div[^>]*>📎 Adjuntos:.*?<\/div>/gi, '')
                .replace(/<[^>]+>/g, '')
                .trim();
                
            return {
                rol: msg.role,
                texto: rawText,
                html_original: cleanHTML,
                archivos_adjuntos: msg.archivos_adjuntos || [],
                imagenes_adjuntas: msg.imagenes_adjuntas || []
            };
        });

        const jsonString = JSON.stringify(cleanChatData, null, 2);
        folder.file(`${currentChatTitle}_chat.json`, jsonString);
        
        // DESCARGAR IMÁGENES
        const fetchPromises = [];
        if (currentImageAssets) {
            for (const url in currentImageAssets) {
                const asset = currentImageAssets[url];
                if (asset && asset.url && asset.filename) {
                    const p = fetch(asset.url)
                        .then(res => res.blob())
                        .then(blob => {
                            folder.file(asset.filename, blob);
                        })
                        .catch(err => console.error("Error descargando imagen", asset.url, err));
                    fetchPromises.push(p);
                }
            }
        }

        // DESCARGAR ARCHIVOS DEL ROBOT
        if (currentFileAssets) {
            for (const fileName in currentFileAssets) {
                const fileUrl = currentFileAssets[fileName];
                if (fileUrl) {
                    const p = fetch(fileUrl)
                        .then(res => res.blob())
                        .then(blob => {
                            folder.file(fileName, blob); // Guardamos con su nombre original ("pdf 1.pdf")
                        })
                        .catch(err => console.error("Error descargando archivo robótico", fileUrl, err));
                    fetchPromises.push(p);
                }
            }
        }

        await Promise.all(fetchPromises);

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        
        chrome.downloads.download({
            url: url,
            filename: `${folderName}.zip`,
            saveAs: true
        });
        
        btn.innerText = "3. Exportar Todo (ZIP)";
        btn.disabled = false;
    } catch(e) {
        console.error(e);
        btn.innerText = "Error al exportar";
        btn.disabled = false;
    }
});

function extractChatFromPage() {
  const allNodes = Array.from(document.querySelectorAll('.prose, .whitespace-pre-wrap, img'));
  
  const validNodes = allNodes.filter(node => {
      if (node.closest('fieldset, form, textarea')) return false;
      if (node.tagName === 'IMG' && (node.src.includes('avatar') || node.src.includes('profile'))) return false;
      if (node.innerText && node.innerText.includes('puede cometer errores')) return false;
      return true;
  });

  validNodes.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const topNodes = validNodes.filter(node => !validNodes.some(p => p !== node && p.contains(node)));

  const messages = [];
  let currentMessage = null;
  const imageMap = {};
  let imageCounter = 1;

  const finalizeMessage = () => {
      if (currentMessage && currentMessage.content.trim()) {
          messages.push(currentMessage);
      }
  };

  for (const node of topNodes) {
      let role = 'Unknown';
      let html = '';
      let attachedFiles = [];
      let attachedImages = [];

      if (node.classList.contains('prose')) {
          role = 'Claude';
          html = node.innerHTML;
          
      } else if (node.classList.contains('whitespace-pre-wrap')) {
          role = 'User';
          
          let attachmentsHTML = '';
          let prev = node.previousElementSibling;
          if (!prev && node.parentElement) prev = node.parentElement.previousElementSibling;
          
          if (prev) {
              let pText = prev.innerText || '';
              pText = pText.replace(/Dijiste:\s*/gi, '').replace(/Editar/gi, '').trim();
              
              const promptText = node.innerText.trim();
              if (promptText) {
                  const escaped = promptText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  pText = pText.replace(new RegExp(escaped, 'gi'), '').trim();
              }
              
              const filesText = pText.replace(/\n+/g, ' | ').trim();
              if (filesText && filesText.length > 0 && filesText.length < 200) {
                  filesText.split('|').forEach(f => {
                      if(f.trim()) attachedFiles.push(f.trim());
                  });
                  attachmentsHTML = `<div style="display: inline-block; background: rgba(0,0,0,0.08); padding: 6px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 8px; font-weight: 600; color: #333;">📎 Adjuntos: ${filesText}</div><br>`;
              }
          }

          let encodedPrompt = node.innerText.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
          html = attachmentsHTML + encodedPrompt;
          
      } else if (node.tagName === 'IMG') {
          // Filtrar las miniaturas de los PDF/archivos para que no se descarguen como imagen normal
          let isAttachmentThumb = false;
          let parentBtn = node.closest('button, [role="button"], .group, a');
          if (parentBtn && parentBtn.innerText) {
              let pText = parentBtn.innerText.toLowerCase();
              if (pText.includes('pdf') || pText.includes('csv') || pText.includes('xls') || pText.includes('docx')) {
                  isAttachmentThumb = true;
              }
          }
          if (isAttachmentThumb) continue; // Salta esta imagen, es una previsualización de documento

          if (node.closest('[data-message-author="user"], [data-is-user="true"], .font-user-message')) {
              role = 'User';
          } else if (node.closest('[data-message-author="assistant"], [data-is-user="false"], .font-claude-message')) {
              role = 'Claude';
          } else {
              const nextText = topNodes.find(n => n !== node && (node.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) && (n.classList.contains('prose') || n.classList.contains('whitespace-pre-wrap')));
              if (nextText) {
                  role = nextText.classList.contains('whitespace-pre-wrap') ? 'User' : 'Claude';
              } else {
                  role = currentMessage ? currentMessage.role : 'Claude';
              }
          }
          
          let filename = null;
          if (!imageMap[node.src]) {
               filename = `imagen_${imageCounter++}.jpg`;
               imageMap[node.src] = { url: node.src, filename: filename };
          } else {
               filename = imageMap[node.src].filename;
          }
          
          if (filename) attachedImages.push(filename);
          let dataAttr = filename ? `data-filename="${filename}"` : '';
          
          html = `<img src="${node.src}" ${dataAttr} style="max-width: 100%; border-radius: 8px; margin: 10px 0; display: block; box-shadow: 0 2px 5px rgba(0,0,0,0.15);">`;
      }

      if (role === 'Unknown') continue;

      if (!currentMessage) {
          currentMessage = { 
              role: role, 
              content: html, 
              isHTML: true,
              archivos_adjuntos: attachedFiles,
              imagenes_adjuntas: attachedImages
          };
      } else if (currentMessage.role === role) {
          if (role === 'Claude' && node.classList.contains('prose')) {
              currentMessage.content += '<br><br>' + html;
          } else {
              currentMessage.content += html;
          }
          if (attachedFiles.length > 0) currentMessage.archivos_adjuntos.push(...attachedFiles);
          if (attachedImages.length > 0) currentMessage.imagenes_adjuntas.push(...attachedImages);
      } else {
          finalizeMessage();
          currentMessage = { 
              role: role, 
              content: html, 
              isHTML: true,
              archivos_adjuntos: attachedFiles,
              imagenes_adjuntas: attachedImages
          };
      }
  }
  
  finalizeMessage();
  
  return {
      title: document.title,
      messages: messages,
      imageAssets: imageMap
  };
}
