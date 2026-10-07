const OpenAI = require('openai');
const Product = require('../models/Product');
const Boutique = require('../models/Boutique');
const { buildOfflineReply } = require('../utils/chatbotFallback');

const getConversationHistory = (history) => {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((turn) => (
      turn
      && (turn.role === 'user' || turn.role === 'assistant')
      && typeof turn.content === 'string'
      && turn.content.trim()
    ))
    .slice(-10)
    .map(({ role, content }) => ({ role, content: content.trim().slice(0, 1000) }));
};

// @desc    Get chatbot response (RAG)
// @route   POST /api/chatbot
// @access  Public
const getChatbotResponse = async (req, res) => {
  try {
    const { message, history } = req.body;

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    // 1. Search DB for relevant context
    const keywords = message.trim().split(/\s+/).filter(word => word.length > 3);

    let context = '';
    let products = [];
    let boutiques = [];

    if (keywords.length > 0) {
      const keywordPattern = keywords
        .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      const productQuery = {
        $or: [
          { name: { $regex: keywordPattern, $options: 'i' } },
          { description: { $regex: keywordPattern, $options: 'i' } },
          { category: { $regex: keywordPattern, $options: 'i' } }
        ]
      };

      const boutiqueQuery = {
        $or: [
          { name: { $regex: keywordPattern, $options: 'i' } },
          { description: { $regex: keywordPattern, $options: 'i' } }
        ]
      };

      [products, boutiques] = await Promise.all([
        Product.find(productQuery).limit(5).select('name description price category').lean(),
        Boutique.find(boutiqueQuery).limit(3).select('name description').lean()
      ]);

      if (products.length > 0) {
        context += '\nRelevant Products found in our database:\n';
        products.forEach(p => {
          context += `- ${p.name}: ${p.price} PKR, Category: ${p.category}. ${p.description.substring(0, 100)}...\n`;
        });
      }

      if (boutiques.length > 0) {
        context += '\nRelevant Boutiques found in our database:\n';
        boutiques.forEach(b => {
          context += `- ${b.name}: ${b.description.substring(0, 100)}...\n`;
        });
      }
    }

    // No AI key configured: answer from the built-in FAQ rules and the catalogue
    if (!process.env.GROQ_API_KEY) {
      return res.json({ success: true, reply: buildOfflineReply(message, products, boutiques), offline: true });
    }

    const groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });

    // 2. Construct Prompt for Groq (Llama 3)
    const systemPrompt = `You are "Stitchie", the AI assistant for Auto Stitch, a premium fashion platform in Pakistan. 
Your goal is to help users find products, boutiques, and understand our features like Virtual Try-On and Customization.

Context from our Database:
${context || 'No specific products or boutiques matched this exact query, but you can suggest browsing our general catalogue.'}

Instructions:
- Be professional, helpful, and stylish.
- Use the context provided above to give specific recommendations if available.
- If a user asks about "Virtual Try-On", tell them it's a feature where they can upload their photo to see how clothes look on them.
- If they ask about "Customization", explain they can request modifications and boutiques will bid on their requests.
- Keep answers concise (max 3-4 sentences).
- Only mention products, boutiques, prices, collections or site filters that appear in the context above. Never invent them. If nothing matches, say you couldn't find it and suggest browsing the Catalogue page.
- The user may make spelling mistakes; interpret their intent.
- If you don't know something, suggest they contact our support or visit the Contact page.`;

    const candidateModels = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
    const conversationHistory = getConversationHistory(history);

    let completion = null;

    for (const modelName of candidateModels) {
      try {
        completion = await groq.chat.completions.create({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
            { role: "user", content: message.trim() },
          ],
          temperature: 0.7,
          max_tokens: 300,
        });
        if (completion?.choices?.[0]?.message?.content) {
          break;
        }
      } catch (err) {
        console.log(`[Groq] Model ${modelName} notice: ${err.message}, trying next candidate...`);
      }
    }

    if (completion?.choices?.[0]?.message?.content) {
      return res.json({ success: true, reply: completion.choices[0].message.content });
    }

    return res.status(503).json({
      success: false,
      message: 'Chatbot is temporarily unavailable. Please try again shortly.',
    });
  } catch (error) {
    console.error('Groq Chatbot Error:', error);
    res.status(500).json({ success: false, message: 'I am having trouble stitching together an answer right now. Please try again later.' });
  }
};

module.exports = { getChatbotResponse };
