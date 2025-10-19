import { kv } from '@vercel/kv';
import TelegramBot from 'node-telegram-bot-api';
import { NextResponse } from 'next/server';

// Hàm helper để lấy link từ text
function extractLinks(text) {
  if (!text) return [];
  // Regex này tìm các URL bắt đầu bằng http:// hoặc https://
  const urlRegex = /(https?:\/\/[^\s"'<>()\[\]{}]+)/g;
  const matches = text.match(urlRegex);
  
  // Loại bỏ các ký tự đặc biệt ở cuối link (ví dụ: dấu . , ) )
  if (matches) {
    return matches.map(url => url.replace(/[.,\)]*$/, ''));
  }
  return [];
}

// Hàm xử lý cho App Router
export async function POST(req) {
  try {
    const body = await req.json(); // Lấy body từ request
    const { message } = body;

    // Nếu không có message (ví dụ: callback query, edit...) thì bỏ qua
    if (!message || !message.chat || !message.chat.id) {
      console.log('No message or chat ID received, skipping.');
      return NextResponse.json({ status: 'OK (No message)' }, { status: 200 });
    }

    const chatId = message.chat.id;
    // Lấy text từ message hoặc caption của ảnh/video
    const text = message.text || message.caption;
    const messageId = message.message_id;

    // Ghi log để bạn theo dõi trên Vercel
    console.log(`Received message from chat ID: ${chatId}`);

    // 1. Kiểm tra xem topic này đã bị đóng chưa
    const isClosed = await kv.get(`topic:${chatId}:closed`);
    if (isClosed) {
      console.log(`Topic ${chatId} is closed. Ignoring message.`);
      return NextResponse.json({ status: 'Topic is closed' }, { status: 200 });
    }

    // 2. Kiểm tra tin nhắn "Topic closed"
    if (text && text.toLowerCase().includes('topic closed')) {
      // Đặt cờ "closed" cho topic này, tự động hết hạn sau 30 ngày
      await kv.set(`topic:${chatId}:closed`, true, { ex: 2592000 }); // 30 ngày
      
      try {
        const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
        await bot.sendMessage(chatId, '✅ Đã nhận tín hiệu. Topic này sẽ ngừng cập nhật link.');
      } catch (botError) {
        console.error('Failed to send "Topic closed" confirmation:', botError.message);
      }
      
      console.log(`Topic ${chatId} has been marked as closed.`);
      return NextResponse.json({ status: 'Topic closed' }, { status: 200 });
    }

    // 3. Lấy và lưu các liên kết
    const links = extractLinks(text);
    if (links.length > 0) {
      const today = new Date().toISOString().split('T')[0]; // Định dạng YYYY-MM-DD
      const key = `links:${chatId}:${today}`; // Key cho ngày hôm nay
      
      // Thêm các link vào một Set trong Vercel KV
      await kv.sadd(key, ...links);
      console.log(`Added ${links.length} links to ${key}`);
    } else {
      console.log('No links found in message.');
    }

    // Phản hồi 200 OK cho Telegram
    return NextResponse.json({ status: 'OK' }, { status: 200 });

  } catch (error) {
    console.error('Error processing webhook:', error.message);
    if (error.response) {
      console.error('Error details:', error.response.body);
    }
    // Trả về lỗi
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Thêm dòng này để Vercel xử lý đúng cách (nếu bạn dùng Edge Runtime)
// Nếu gặp lỗi, bạn có thể xóa dòng này
// export const runtime = 'edge';