document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form');
    const chatBox = document.getElementById('chat');
    const input = document.getElementById('userInput');
  
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userMessage = input.value;
      input.value = '';
  
      appendMessage('Tú', userMessage, 'user');
  
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
      });
  
      const data = await response.json();
      appendMessage('Bot', data.reply, 'bot');
    });
  
    function appendMessage(sender, text, type) {
      const div = document.createElement('div');
      div.className = `message ${type}`;
      div.innerHTML = `<strong>${sender}:</strong> ${text}`;
      chatBox.appendChild(div);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  });
  