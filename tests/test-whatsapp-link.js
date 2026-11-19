const assert = require('node:assert/strict');
const { getWhatsAppSendRequest, getWhatsAppWebChatUrl, normalizeWhatsAppPhone, getWhatsAppPhoneCandidates } = require('../electron/whatsappLink');

const exampleUrl = 'https://api.whatsapp.com/send/?phone=5584933004200&text=🏨%20RESUMO%20DA%20RESERVA%0A%0A👤%20HÓSPEDE%20RESPONSÁVEL%20PELA%20RESERVA%0A•%20Nome%3A%20Cliente%20TESTE%0A•%20Telefone%3A%20%2884%29%2093300-4200%0A%0A👥%20HÓSPEDES%20ADICIONAIS%0A•%20Nome%3A%20cliente%20teste%202%0A•%20Telefone%3A%20%2888%29%2088888-8888%0A%0A📅%20Período%3A%2014%2F09%2F2026%20a%2015%2F09%2F2026%0A🛏%EF%B8%8F%20Acomodação%3A%20Luxo%20-%202%0A👥%20Quantidade%20de%20hóspedes%3A%202%0A🌙%20Diárias%3A%201%0A💰%20Valor%20final%20previsto%3A%20R%24%20152%2C00%0A%0A✅%20RESERVA%20CONFIRMADA%21%0A%0AAgradecemos%20pela%20preferência%20e%20por%20escolher%20nossa%20pousada.%0A%0ADesejamos%20uma%20excelente%20estadia.%20Estamos%20à%20disposição%20para%20ajudar%20no%20que%20for%20necessário%21';
const request = getWhatsAppSendRequest(exampleUrl);

assert.equal(request?.phone, '5584933004200');
const supportChatUrl = getWhatsAppWebChatUrl(
	'https://api.whatsapp.com/send/?phone=5584933004200&text=Olá%2C+Sátiro+Sistemas%21+Preciso+de+ajuda&type=phone_number&app_absent=0'
);
const supportRequest = getWhatsAppSendRequest(
	'https://api.whatsapp.com/send/?phone=5584933004200&text=Olá%2C+Sátiro+Sistemas%21+Preciso+de+ajuda&type=phone_number&app_absent=0'
);
assert.equal(new URL(supportChatUrl).origin, 'https://web.whatsapp.com');
assert.equal(new URL(supportChatUrl).pathname, '/send');
assert.equal(new URL(supportChatUrl).searchParams.get('phone'), '5584933004200');
assert.equal(new URL(supportChatUrl).searchParams.get('text'), 'Olá, Sátiro Sistemas! Preciso de ajuda');
assert.equal(supportRequest?.phone, '5584933004200');
assert.equal(supportRequest?.message, 'Olá, Sátiro Sistemas! Preciso de ajuda');
assert.equal(supportRequest?.openOnly, false);
assert.equal(getWhatsAppWebChatUrl('https://example.com/send?phone=1234567&text=oi'), null);
assert.ok(request.message.startsWith('🏨 RESUMO DA RESERVA\n\n👤 HÓSPEDE RESPONSÁVEL'));
assert.ok(request.message.includes('Acomodação: Luxo - 2'));
assert.ok(request.message.endsWith('necessário!'));
assert.equal(normalizeWhatsAppPhone(request.phone), '5584933004200');
assert.deepEqual(getWhatsAppPhoneCandidates(request.phone), ['5584933004200', '558433004200']);

const secondRequest = getWhatsAppSendRequest(
	'https://api.whatsapp.com/send/?phone=551187654321&text=Outra%20mensagem%20%F0%9F%91%8B'
);
assert.equal(secondRequest?.phone, '551187654321');
assert.equal(secondRequest?.message, 'Outra mensagem 👋');
assert.equal(normalizeWhatsAppPhone(secondRequest.phone), '551187654321');
assert.equal(normalizeWhatsAppPhone('5584991361736'), '5584991361736');
assert.deepEqual(getWhatsAppPhoneCandidates('5584991361736'), ['5584991361736', '558491361736']);

const openOnlyRequest = getWhatsAppSendRequest(
	'https://api.whatsapp.com/send/?phone=5584991361736&text&type=phone_number&app_absent=0'
);
assert.equal(openOnlyRequest?.phone, '5584991361736');
assert.equal(openOnlyRequest?.message, '');
assert.equal(openOnlyRequest?.openOnly, true);
assert.equal(normalizeWhatsAppPhone(openOnlyRequest.phone), '5584991361736');
assert.deepEqual(getWhatsAppPhoneCandidates('84933004200'), ['84933004200', '8433004200']);
assert.deepEqual(getWhatsAppPhoneCandidates('84991361736'), ['84991361736', '8491361736']);
assert.equal(getWhatsAppSendRequest('https://api.whatsapp.com/send/?phone=abc&text'), null);

console.log('Links com números e mensagens diferentes foram parseados corretamente.');