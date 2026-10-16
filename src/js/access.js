const form = document.getElementById('accessForm');
const passwordInput = document.getElementById('password');
const submitButton = document.getElementById('submitButton');
const exitButton = document.getElementById('exitButton');
const status = document.getElementById('status');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  if (!password) return;

  passwordInput.disabled = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Consultando acesso…';
  status.textContent = 'Verificando a senha. Esta consulta será feita uma vez nesta abertura.';

  try {
    const result = await window.accessGate.verify(password);
    if (result?.status === 'active') return;
    status.textContent = result?.message || 'Não foi possível liberar o acesso.';
    form.hidden = true;
    exitButton.hidden = false;
    exitButton.focus();
  } catch {
    status.textContent = 'Não foi possível verificar o acesso. Feche o aplicativo e tente novamente.';
    form.hidden = true;
    exitButton.hidden = false;
    exitButton.focus();
  }
});

exitButton.addEventListener('click', () => window.accessGate.exit());