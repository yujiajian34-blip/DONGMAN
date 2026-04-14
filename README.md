# 🎨 DONGMAN - Manga Character Replacer

> AI-powered manga character replacement tool built with Next.js and Gemini AI

[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?style=flat&logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.2-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com)

## ✨ Features

- 🖼️ **Batch Image Processing**: Upload multiple manga panels for character replacement
- 🎭 **Character Library**: Save and manage target character references locally
- 🎯 **ROI Selection**: Define regions of interest for precise character replacement
- 🤖 **AI-Powered**: Leverages Gemini 3.1 Flash Image Preview for high-quality results
- 📦 **One-Click Export**: Download all processed images as a ZIP archive
- 🗜️ **Smart Compression**: Automatic image compression to optimize local storage usage
- 🌓 **Responsive Design**: Works seamlessly on desktop and mobile devices

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or pnpm
- Gemini Gateway API access

### Installation

```bash
# Clone the repository
git clone https://github.com/yujiajian34-blip/DONGMAN.git
cd DONGMAN

# Install dependencies
npm install

# Set up environment variables (see Configuration section)
cp .env.example .env.local  # Edit with your API credentials

# Start development server
npm run dev
```

### Usage

1. Open `http://localhost:3000` in your browser
2. **Add Target Character**: Upload a reference image in the Character Library panel
3. **Upload Source Images**: Add manga panels to the workbench queue
4. **Configure ROI** (optional): Draw a region of interest for precise replacement
5. **Execute Replacement**: Click "Execute Batch Replace" to process all images
6. **Download Results**: Click "下载 ZIP" to export completed images

## 📁 Project Structure

```
DONGMAN/
├── app/
│   ├── api/replace/route.ts    # Gemini API gateway proxy
│   ├── page.tsx                # Main application component
│   ├── layout.tsx              # Root layout
│   └── globals.css             # Global styles
├── components/
│   ├── CharacterLibrary.tsx    # Character management UI
│   └── ReplacerWorkbench.tsx   # Image processing workbench
├── hooks/
│   └── useCharacterStore.ts    # Local storage state management
├── utils/
│   └── compressImage.ts        # Image compression utility
├── package.json                # Project dependencies
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This file
```

## ⚙️ Configuration

### Environment Variables

Create a `.env.local` file with the following variables:

```env
# Gemini Gateway Configuration
GEMINI_GATEWAY_TOKEN=your_gateway_token_here
GATEWAY_TIMEOUT_MS=70000

# Optional: Enable debug logging
REPLACE_DEBUG=1
```

> ⚠️ **Security Note**: Never commit `.env.local` to version control. The `.gitignore` file already excludes it.

### API Gateway

This project proxies requests to a Gemini AI gateway. Ensure you have:
- Valid gateway endpoint URL (configured in `app/api/replace/route.ts`)
- Proper authentication token via `GEMINI_GATEWAY_TOKEN` environment variable

## 🛠️ Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on `localhost:3000` |
| `npm run build` | Create production build |
| `npm run start` | Start production server |
| `npm run typecheck` | Run TypeScript type checking |

### Code Quality

- TypeScript strict mode enabled
- ESLint configuration via Next.js defaults
- Prettier formatting recommended

## 🔍 Technical Details

### Image Processing Flow

1. **Upload**: User selects manga panel images (client-side base64 encoding)
2. **Preparation**: Optional ROI selection and prompt customization
3. **API Request**: POST to `/api/replace` with source + target character images
4. **Gateway Proxy**: Server forwards request to Gemini gateway with retry logic
5. **Result Scoring**: Client calculates candidate quality scores using pixel analysis
6. **Display**: Best result shown with option to select alternatives
7. **Export**: ZIP generation via JSZip for batch download

### Storage Optimization

- Character images are automatically compressed (512px max width, 70% JPEG quality) before localStorage persistence
- Prevents "quota exceeded" errors when storing multiple character references
- Compression utility: `utils/compressImage.ts`

### Error Handling

- Gateway timeout protection (configurable via `GATEWAY_TIMEOUT_MS`)
- Client-side retry logic for transient failures
- User-friendly error messages with actionable guidance

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is proprietary. See repository owner for licensing terms.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org) - React framework
- [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS framework
- [lucide-react](https://lucide.dev) - Beautiful SVG icons
- [JSZip](https://stuk.github.io/jszip/) - Client-side ZIP generation
- [file-saver](https://github.com/eligrey/FileSaver.js) - File saving utility

---

> **Note**: This application requires access to a Gemini AI gateway service. Ensure you have proper API credentials and network access before deployment.

🔗 **Repository**: https://github.com/yujiajian34-blip/DONGMAN
