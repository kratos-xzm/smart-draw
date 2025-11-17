import { NextResponse } from 'next/server';
import { callLLM } from '@/lib/llm-client';

/**
 * POST /api/llm/stream
 * Transparent proxy for LLM requests (frontend constructs complete messages)
 */
export async function POST(request) {
  try {
    const { config, messages } = await request.json();

    // Parameter validation
    if (!config || !messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Missing required parameters: config, messages' },
        { status: 400 }
      );
    }

    // Validate config structure
    if (!config.type || !config.apiKey) {
      return NextResponse.json(
        { error: 'Invalid config: missing type or apiKey' },
        { status: 400 }
      );
    }

    // Create SSE stream for transparent forwarding
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await callLLM(config, messages, (chunk) => {
            // Send each chunk as SSE
            const data = `data: ${JSON.stringify({ content: chunk })}\n\n`;
            controller.enqueue(encoder.encode(data));
          });

          // Send done signal
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('Error in stream:', error);
          const errorData = `data: ${JSON.stringify({ error: error.message })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in /api/llm/stream:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to stream LLM response' },
      { status: 500 }
    );
  }
}
