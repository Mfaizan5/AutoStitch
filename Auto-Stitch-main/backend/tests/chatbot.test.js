jest.mock('openai', () => jest.fn());
jest.mock('../models/Product', () => ({ find: jest.fn() }));
jest.mock('../models/Boutique', () => ({ find: jest.fn() }));

const OpenAI = require('openai');
const Product = require('../models/Product');
const Boutique = require('../models/Boutique');
const { getChatbotResponse } = require('../controllers/chatbotController');

const createQuery = (results) => ({
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(results),
});

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
};

describe('chatbot controller', () => {
  let completionCreate;

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key';
    Product.find.mockReturnValue(createQuery([]));
    Boutique.find.mockReturnValue(createQuery([]));
    completionCreate = jest.fn();
    OpenAI.mockImplementation(() => ({
      chat: { completions: { create: completionCreate } },
    }));
  });

  afterAll(() => {
    delete process.env.GROQ_API_KEY;
  });

  it('uses an active Groq model and includes recent conversation turns', async () => {
    completionCreate.mockResolvedValue({
      choices: [{ message: { content: 'Yes, I can help you find a blue dress.' } }],
    });
    const req = {
      body: {
        message: 'Can you find a blue dress?',
        history: [
          { role: 'user', content: 'I need an outfit for a wedding.' },
          { role: 'assistant', content: 'What color do you prefer?' },
        ],
      },
    };
    const res = createResponse();

    await getChatbotResponse(req, res);

    expect(completionCreate).toHaveBeenCalledTimes(1);
    expect(completionCreate.mock.calls[0][0].model).toBe('openai/gpt-oss-20b');
    expect(completionCreate.mock.calls[0][0].messages.slice(-3)).toEqual([
      { role: 'user', content: 'I need an outfit for a wedding.' },
      { role: 'assistant', content: 'What color do you prefer?' },
      { role: 'user', content: 'Can you find a blue dress?' },
    ]);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      reply: 'Yes, I can help you find a blue dress.',
    });
  });

  it('tries the backup active model and reports an error instead of returning a welcome fallback', async () => {
    completionCreate
      .mockRejectedValueOnce(new Error('primary model unavailable'))
      .mockRejectedValueOnce(new Error('backup model unavailable'));
    const res = createResponse();

    await getChatbotResponse({ body: { message: 'What fabric is best for summer?' } }, res);

    expect(completionCreate.mock.calls.map(([options]) => options.model)).toEqual([
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
    ]);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('rejects a blank message', async () => {
    const res = createResponse();

    await getChatbotResponse({ body: { message: '   ' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(completionCreate).not.toHaveBeenCalled();
  });
});
