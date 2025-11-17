import { NextResponse } from 'next/server';

/**
 * POST /api/llm/config
 * Validate access password and return server-side LLM configuration
 */
export async function POST(request) {
  try {
    const accessPassword = request.headers.get('x-access-password');

    // 1. Check if access password is configured on server
    const envPassword = process.env.ACCESS_PASSWORD;
    if (!envPassword) {
      return NextResponse.json(
        {
          success: false,
          error: '服务器未配置访问密码'
        },
        { status: 400 }
      );
    }

    // 2. Validate access password
    if (!accessPassword || accessPassword !== envPassword) {
      return NextResponse.json(
        {
          success: false,
          error: '访问密码错误'
        },
        { status: 401 }
      );
    }

    // 3. Build server-side LLM configuration
    const config = {
      type: process.env.SERVER_LLM_TYPE,
      baseUrl: process.env.SERVER_LLM_BASE_URL,
      apiKey: process.env.SERVER_LLM_API_KEY,
      model: process.env.SERVER_LLM_MODEL,
    };

    // 4. Validate configuration completeness
    if (!config.type || !config.apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'LLM配置不完整'
        },
        { status: 500 }
      );
    }

    // 5. Return configuration to frontend
    return NextResponse.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error in /api/llm/config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get LLM config'
      },
      { status: 500 }
    );
  }
}
