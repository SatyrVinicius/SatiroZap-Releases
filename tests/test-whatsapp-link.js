const assert = require('node:assert/strict');
const { getWhatsAppSendRequest, normalizeWhatsAppPhone } = require('../electron/whatsappLink');

const exampleUrl = 'https://api.whatsapp.com/send/?phone=5584933004200&text=🏨%20RESUMO%20DA%20RESERVA%0A%0A👤%20HÓSPEDE%20RESPONSÁVEL%20PELA%20RESERVA%0A•%20Nome%3A%20Cliente%20TESTE%0A•%20Telefone%3A%20%2884%29%2093300-4200%0A%0A👥%20HÓSPEDES%20ADICIONAIS%0A•%20Nome%3A%20cliente%20teste%202%0A•%20Telefone%3A%20%2888%29%2088888-8888%0A%0A📅%20Período%3A%2014%2F09%2F2026%20a%2015%2F09%2F2026%0A🛏%EF%B8%8F%20Acomodação%3A%20Luxo%20-%202%0A👥%20Quantidade%20de%20hóspedes%3A%202%0A🌙%20Diárias%3A%201%0A💰%20Valor%20final%20previsto%3A%20R%24%20152%2C00%0A%0A✅%20RESERVA%20CONFIRMADA%21%0A%0AAgradecemos%20pela%20preferência%20e%20por%20escolher%20nossa%20pousada.%0A%0ADesejamos%20uma%20excelente%20estadia.%20Estamos%20à%20disposição%20para%20ajudar%20no%20que%20for%20necessário%21';
const request = getWhatsAppSendRequest(exampleUrl);

assert.equal(request?.phone, '5584933004200');
assert.ok(request.message.startsWith('🏨 RESUMO DA RESERVA\n\n👤 HÓSPEDE RESPONSÁVEL'));
assert.ok(request.message.includes('Acomodação: Luxo - 2'));
assert.ok(request.message.endsWith('necessário!'));
assert.equal(normalizeWhatsAppPhone(request.phone), '558433004200');

const secondRequest = getWhatsAppSendRequest(
	'https://api.whatsapp.com/send/?phone=551187654321&text=Outra%20mensagem%20%F0%9F%91%8B'
);
assert.equal(secondRequest?.phone, '551187654321');
assert.equal(secondRequest?.message, 'Outra mensagem 👋');
assert.equal(normalizeWhatsAppPhone(secondRequest.phone), '551187654321');
assert.equal(normalizeWhatsAppPhone('5584991361736'), '558491361736');

console.log('Links com números e mensagens diferentes foram parseados corretamente.');