import React, { useState, useEffect } from 'react';
import { Clipboard, Check, Wand2, Mail, AlertCircle, FileText, Send, RefreshCw, Lightbulb, Loader2, FileEdit, Box, Barcode, Download } from 'lucide-react';
import { jsPDF } from 'jspdf';

const ReportGenerator = () => {
  // Configuración de API Key (Desde variables de entorno)
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; 

  // Estado principal del formulario
  const [formData, setFormData] = useState({
    category: 'I',
    line: '',
    model: '',
    title: '',
    shortDesc: '',
    // Material Defectuoso
    isMaterialDefect: false,
    materialName: '',
    batch: '', // Embarque/Lote
    partNumber: '',
    failureRate: '',
    code8s: '',
    // Problema Generico
    what: '',
    where: '',
    when: '',
    howDetected: '',
    scope: '',
    severity: '',
    // Análisis
    howHappened: '',
    rootCause: '',
    justification: '',
    // Solución
    actionType: 'contencion', // contencion | solucion
    actionDone: '',
    who: '',
    howDone: '',
    resources: '',
    nextSteps: '', // Solo contención
    improvement: '' // Solo solución
  });

  const [generatedSubject, setGeneratedSubject] = useState('');
  const [generatedBody, setGeneratedBody] = useState(''); // Cuerpo basado en plantilla
  const [aiReportText, setAiReportText] = useState(''); // Cuerpo narrativo generado por IA
  const [showAiReport, setShowAiReport] = useState(false); // Toggle para ver reporte IA vs Plantilla

  const [copiedSubject, setCopiedSubject] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  
  // Estados de carga para IA
  const [isPolishing, setIsPolishing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [aiError, setAiError] = useState(null);

  const categories = [
    { value: 'I', label: 'I - Importante y Urgente', desc: 'Grave, impacto inmediato' },
    { value: 'II', label: 'II - Importante No Urgente', desc: 'Grave, pero hay tiempo' },
    { value: 'III', label: 'III - No Importante Pero Urgente', desc: 'No grave, solucionar pronto' },
    { value: 'IV', label: 'IV - Ni Importante Ni Urgente', desc: 'Informativo' },
  ];

  // Helper para formato Oración (Primera mayúscula, resto minúscula)
  const toSentenceCase = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  // Actualizar campos con reglas de formato
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let finalValue = type === 'checkbox' ? checked : value;

    // Reglas de formato específicas
    if (type !== 'checkbox') {
        if (name === 'line' || name === 'model' || name === 'code8s' || name === 'partNumber') {
            finalValue = value.toUpperCase();
        } else if (name === 'title' || name === 'shortDesc') {
            // Aplicamos formato oración en tiempo real (puede ser agresivo, pero cumple el requerimiento estricto)
            finalValue = toSentenceCase(value);
        }
    }

    setFormData(prev => ({ ...prev, [name]: finalValue }));
    
    // Si editamos algo, volvemos a la vista de plantilla
    if (showAiReport) {
        setShowAiReport(false);
    }
  };

  // Efecto para actualizar el Asunto en tiempo real
  useEffect(() => {
    const subject = `${formData.category} - ${formData.line || '[LÍNEA]'} - ${formData.model || '[MODELO]'} - ${formData.title || '[Título]'} : ${formData.shortDesc || '[Descripción]'}`;
    setGeneratedSubject(subject);
  }, [formData.category, formData.line, formData.model, formData.title, formData.shortDesc]);

  // Función para construir el cuerpo del correo (PLANTILLA BASE)
  const buildBody = () => {
    const typeLabel = formData.actionType === 'contencion' ? 'PLAN DE CONTENCIÓN' : 'SOLUCIÓN DEFINITIVA';
    
    let actionSpecifics = '';
    if (formData.actionType === 'contencion') {
      actionSpecifics = `
**Próximos Pasos:**
${formData.nextSteps || '-'}
      `;
    } else {
      actionSpecifics = `
**Mejora en el proceso:**
${formData.improvement || '-'}
      `;
    }

    let problemDetails = '';
    if (formData.isMaterialDefect) {
        problemDetails = `
• Material: ${formData.materialName || '-'}
• Embarque/Lote: ${formData.batch || '-'}
• Part Number: ${formData.partNumber || '-'}
• Failure Rate: ${formData.failureRate || '-'}
• Code 8S: ${formData.code8s || '-'}
• Descripción del defecto: ${formData.what || '-'}
        `.trim();
    } else {
        problemDetails = `• ¿Qué sucedió?: ${formData.what || '-'}`;
    }

    return `
ESTIMADOS,

Se detalla a continuación el reporte de la incidencia:

1. PLANTEAMIENTO DEL PROBLEMA
--------------------------------------------------
${problemDetails}
• ¿Dónde?: ${formData.where || '-'}
• ¿Cuándo?: ${formData.when || '-'}
• ¿Cómo se descubrió?: ${formData.howDetected || '-'}
• Alcance: ${formData.scope || '-'}
• Gravedad/Consecuencias: ${formData.severity || '-'}

[ADJUNTAR EVIDENCIA VISUAL AQUÍ]

2. ANÁLISIS (CAUSA RAÍZ)
--------------------------------------------------
• Mecánica de la falla (¿Cómo sucede?): 
${formData.howHappened || '-'}

• Causa Raíz (¿Qué lo provoca?): 
${formData.rootCause || '-'}

• Justificación (Evidencia del análisis): 
${formData.justification || '-'}

[ADJUNTAR GRÁFICOS O MQS AQUÍ]

3. ${typeLabel}
--------------------------------------------------
• ¿Qué se hizo?: ${formData.actionDone || '-'}
• Responsable: ${formData.who || '-'}
• Metodología/Recursos: ${formData.howDone || 'Standard'} / ${formData.resources || 'N/A'}
${actionSpecifics}

[ADJUNTAR EVIDENCIA DE SOLUCIÓN]
    `.trim();
  };

  // Actualizar cuerpo base cuando cambian los datos
  useEffect(() => {
    setGeneratedBody(buildBody());
  }, [formData]);

  // --- GEMINI API HELPERS ---

  const callGemini = async (prompt, systemInstruction = "", responseFormat = "application/json") => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: responseFormat
      }
    };

    const delays = [1000, 2000, 4000, 8000, 16000];
    let attempt = 0;

    while (attempt <= 5) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
           if (response.status === 429 || response.status >= 500) {
             throw new Error(`Server error: ${response.status}`);
           }
           const errorData = await response.json();
           throw new Error(errorData.error?.message || `API Error: ${response.status}`);
        }

        const data = await response.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textResponse) throw new Error("Empty response from Gemini");
        
        return responseFormat === "application/json" ? JSON.parse(textResponse) : textResponse;

      } catch (error) {
        if (attempt === 5) throw error;
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        attempt++;
      }
    }
  };

  // --- FEATURES IA ---

  // 1. Mejorar Redacción (SOLO CUERPO)
  const polishTextWithGemini = async () => {
    setIsPolishing(true);
    setAiError(null);

    // EXCLUIMOS title, shortDesc, line, model para que la IA no los toque
    const fieldsToPolish = {
      what: formData.what,
      howDetected: formData.howDetected,
      scope: formData.scope,
      severity: formData.severity,
      howHappened: formData.howHappened,
      rootCause: formData.rootCause,
      justification: formData.justification,
      actionDone: formData.actionDone,
      nextSteps: formData.nextSteps,
      improvement: formData.improvement,
      // Solo incluimos material description si aplica, pero no los códigos duros
      materialName: formData.materialName 
    };

    const prompt = `
      Reescribe los textos para un reporte industrial: formal, técnico y conciso.
      Corrige ortografía.
      Mantén el significado.
      Entrada JSON: ${JSON.stringify(fieldsToPolish)}
    `;

    const systemPrompt = "Eres un experto redactor técnico. Devuelve JSON con las mismas claves.";

    try {
      const polishedData = await callGemini(prompt, systemPrompt, "application/json");
      setFormData(prev => ({ ...prev, ...polishedData }));
      setShowAiReport(false);
    } catch (error) {
      console.error("Error polishing text:", error);
      setAiError("Error de conexión con IA.");
    } finally {
      setIsPolishing(false);
    }
  };

  // 2. Sugerir Análisis (Thinking Partner)
  const suggestAnalysisWithGemini = async () => {
    const problemDesc = formData.isMaterialDefect 
        ? `Material: ${formData.materialName}. Defecto: ${formData.what}` 
        : formData.what;

    if (!problemDesc || problemDesc.length < 5) {
      setAiError("Describa el problema antes de pedir análisis.");
      return;
    }
    setIsAnalyzing(true);
    setAiError(null);

    const prompt = `
      Problema: "${problemDesc}". Contexto: Línea ${formData.line}, Modelo ${formData.model}.
      Sugiere: 'howHappened' (Mecánica técnica) y 'rootCause' (Causa raíz probable).
    `;
    
    try {
      const analysisData = await callGemini(prompt, "Eres ingeniero experto en análisis de fallas. Responde JSON.", "application/json");
      setFormData(prev => ({
        ...prev,
        howHappened: prev.howHappened ? prev.howHappened : analysisData.howHappened,
        rootCause: prev.rootCause ? prev.rootCause : analysisData.rootCause
      }));
      setShowAiReport(false);
    } catch (error) {
      setAiError("Error al generar sugerencias.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 3. Generar Reporte Narrativo Conciso
  const generateNarrativeReport = async () => {
    setIsGeneratingReport(true);
    setAiError(null);

    // Contexto de acción
    const actionLabel = formData.actionType === 'contencion' ? 'PLAN DE CONTENCIÓN' : 'SOLUCIÓN DEFINITIVA';

    const prompt = `
      Actúa como un ingeniero de calidad redactando un informe formal.
      Usa la información del formulario JSON para escribir un reporte narrativo.
      
      REGLAS CRÍTICAS DE REDACCIÓN:
      1. SÉ EXTREMADAMENTE CONCISO Y DIRECTO. Elimina palabras de relleno.
      2. Ve al grano. Usa lenguaje ejecutivo.
      3. NO uses formato de preguntas y respuestas.
      4. Mantén SOLO estas 3 secciones:
         - 1. PLANTEAMIENTO DEL PROBLEMA
         - 2. ANÁLISIS (CAUSA RAÍZ)
         - 3. ${actionLabel}
      5. Si es material defectuoso, incluye los datos de Part Number, Lote, etc. de forma clara y tabular o listada al inicio.
      
      Datos: ${JSON.stringify(formData)}
    `;

    try {
        const narrativeText = await callGemini(prompt, "Eres un redactor técnico senior obsesionado con la brevedad y la precisión.", "text/plain");
        
        const finalText = `ESTIMADOS,\n\nSe presenta el informe técnico correspondiente:\n\n${narrativeText}`;
        
        setAiReportText(finalText);
        setShowAiReport(true);
    } catch (error) {
        console.error("Error generating narrative:", error);
        setAiError("Error al generar el informe narrativo.");
    } finally {
        setIsGeneratingReport(false);
    }
  };


  const copyToClipboard = (text, type) => {
    // Método robusto usando textarea temporal en lugar de navigator.clipboard
    // para evitar bloqueos de permisos en iframes.
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Unable to copy to clipboard', err);
    }
    document.body.removeChild(textArea);

    if (type === 'subject') {
      setCopiedSubject(true);
      setTimeout(() => setCopiedSubject(false), 2000);
    } else {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 2000);
    }
  };

  // Función para traducir el reporte al inglés y generar PDF
  const generateEnglishPDF = async () => {
    setIsGeneratingPDF(true);
    setAiError(null);

    try {
      // Obtener el texto del reporte actual (IA o plantilla)
      const reportText = showAiReport ? aiReportText : generatedBody;

      // Traducir al inglés con Gemini
      const translationPrompt = `
        Translate the following technical report from Spanish to English.
        Maintain the technical terminology and structure.
        Keep the same formatting (bullet points, sections, etc.).

        Report to translate:
        ${reportText}
      `;

      const englishReport = await callGemini(
        translationPrompt,
        "You are a professional technical translator specialized in industrial and quality reports. Maintain precision and technical accuracy.",
        "text/plain"
      );

      // Traducir el asunto también
      const subjectPrompt = `Translate this email subject from Spanish to English, keeping the same format: ${generatedSubject}`;
      const englishSubject = await callGemini(subjectPrompt, "Technical translator", "text/plain");

      // Generar PDF
      const doc = new jsPDF();

      // Configuración de márgenes y ancho
      const margin = 15;
      const pageWidth = doc.internal.pageSize.getWidth();
      const maxWidth = pageWidth - (margin * 2);
      const lineHeight = 7;
      let yPosition = margin;

      // Título (Asunto)
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      const subjectLines = doc.splitTextToSize(englishSubject, maxWidth);
      doc.text(subjectLines, margin, yPosition);
      yPosition += lineHeight * subjectLines.length + 5;

      // Separador
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 10;

      // Cuerpo del reporte
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');

      const reportLines = englishReport.split('\n');

      for (const line of reportLines) {
        // Verificar si necesitamos una nueva página
        if (yPosition > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          yPosition = margin;
        }

        if (line.trim() === '') {
          yPosition += lineHeight / 2;
          continue;
        }

        // Detectar líneas de encabezado (MAYÚSCULAS o con ":")
        if (line.match(/^[A-Z\s\-]+:?$/) || line.startsWith('**')) {
          doc.setFont(undefined, 'bold');
          const headerLines = doc.splitTextToSize(line.replace(/\*\*/g, ''), maxWidth);
          doc.text(headerLines, margin, yPosition);
          yPosition += lineHeight * headerLines.length;
          doc.setFont(undefined, 'normal');
        } else {
          const textLines = doc.splitTextToSize(line, maxWidth);
          doc.text(textLines, margin, yPosition);
          yPosition += lineHeight * textLines.length;
        }
      }

      // Pie de página con fecha
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Generated on ${dateStr}`, margin, doc.internal.pageSize.getHeight() - 10);

      // Descargar el PDF
      const filename = `Report_${formData.line}_${formData.model}_${Date.now()}.pdf`.replace(/\s+/g, '_');
      doc.save(filename);

    } catch (error) {
      console.error("Error generating PDF:", error);
      setAiError("Error generating English PDF. Please try again.");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* COLUMNA IZQUIERDA: INPUTS */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h1 className="text-2xl font-bold text-blue-700 flex items-center gap-2 mb-2">
              <FileText className="w-6 h-6" /> Generador de Reportes
            </h1>
            <p className="text-slate-500 text-sm">
              Complete los campos para generar un correo estandarizado.
            </p>
            {aiError && (
              <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2 border border-red-200 animate-pulse">
                <AlertCircle className="w-4 h-4" /> {aiError}
              </div>
            )}
          </div>

          {/* SECCION 1: ASUNTO (PROTEGIDO) */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-lg font-semibold border-b pb-2 flex items-center gap-2 text-slate-700">
              <Mail className="w-5 h-5 text-blue-600" /> 1. Datos del Asunto
            </h2>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Categoría (Prioridad)</label>
              <select 
                name="category" 
                value={formData.category} 
                onChange={handleChange}
                className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50"
              >
                {categories.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Línea / Planta <span className="text-xs text-gray-400">(Auto-MAYÚS)</span></label>
                <input 
                  type="text" name="line" placeholder="Ej: LÍNEA 11" 
                  value={formData.line} onChange={handleChange}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Modelo / Cliente <span className="text-xs text-gray-400">(Auto-MAYÚS)</span></label>
                <input 
                  type="text" name="model" placeholder="Ej: ARUBA 2" 
                  value={formData.model} onChange={handleChange}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Título Corto <span className="text-xs text-gray-400">(Auto-Oración)</span></label>
              <input 
                type="text" name="title" placeholder="Ej: Display defectuoso" 
                value={formData.title} onChange={handleChange}
                className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Descripción Breve <span className="text-xs text-gray-400">(Auto-Oración)</span></label>
              <input 
                type="text" name="shortDesc" placeholder="Ej: Sin imagen, no funciona touch" 
                value={formData.shortDesc} onChange={handleChange}
                className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* SECCION 2: CUERPO */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-lg font-semibold border-b pb-2 flex items-center justify-between text-slate-700">
              <span className="flex items-center gap-2"><AlertCircle className="w-5 h-5 text-orange-600" /> 2. Planteamiento del Problema</span>
              
              {/* TOGGLE MATERIAL DEFECTUOSO */}
              <label className="inline-flex items-center cursor-pointer">
                <input type="checkbox" name="isMaterialDefect" checked={formData.isMaterialDefect} onChange={handleChange} className="sr-only peer" />
                <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                <span className="ms-3 text-sm font-medium text-gray-700">Material Defectuoso</span>
              </label>
            </h2>
            
            {/* CAMPOS CONDICIONALES DE MATERIAL */}
            {formData.isMaterialDefect && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                    <div className="col-span-2 flex items-center gap-2 text-blue-800 font-bold text-xs uppercase border-b border-blue-200 pb-1 mb-1">
                        <Box className="w-4 h-4" /> Datos de Material de Origen
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Material</label>
                        <input type="text" name="materialName" value={formData.materialName} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Nombre del componente..." />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Embarque / Lote</label>
                        <input type="text" name="batch" value={formData.batch} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Lot ID..." />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Part Number</label>
                        <input type="text" name="partNumber" value={formData.partNumber} onChange={handleChange} className="w-full p-2 text-sm border rounded uppercase" placeholder="P/N..." />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Code 8S</label>
                        <input type="text" name="code8s" value={formData.code8s} onChange={handleChange} className="w-full p-2 text-sm border rounded uppercase" placeholder="8S..." />
                    </div>
                    <div className="col-span-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Failure Rate</label>
                        <input type="text" name="failureRate" value={formData.failureRate} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Ej: 5% (10/200)..." />
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-500 uppercase">{formData.isMaterialDefect ? 'Descripción del Defecto' : '¿Qué sucedió?'}</label>
                <textarea name="what" rows="2" value={formData.what} onChange={handleChange} className="w-full p-2 text-sm border rounded bg-slate-50 focus:bg-white transition-colors" placeholder="Detalle la falla visual o funcional..."></textarea>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">¿Dónde?</label>
                <input type="text" name="where" value={formData.where} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Línea, puesto..." />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">¿Cuándo?</label>
                <input type="text" name="when" value={formData.when} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Fecha, hora..." />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Detección</label>
                <input type="text" name="howDetected" value={formData.howDetected} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="JOT, OQC, etc." />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Alcance</label>
                <input type="text" name="scope" value={formData.scope} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Cantidad, %..." />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Gravedad / Consecuencias</label>
                <input type="text" name="severity" value={formData.severity} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="¿Para línea? ¿Riesgo scrap?" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4 relative">
            <h2 className="text-lg font-semibold border-b pb-2 flex items-center gap-2 text-slate-700">
              <RefreshCw className="w-5 h-5 text-purple-600" /> 3. Análisis
            </h2>

             {/* BOTÓN ASISTENTE DE ANÁLISIS */}
            <button 
                onClick={suggestAnalysisWithGemini}
                disabled={isAnalyzing || isPolishing || isGeneratingReport}
                className="absolute top-4 right-4 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 px-3 py-1 rounded-full flex items-center gap-1 font-medium transition-colors border border-purple-200"
                title="Sugerir causa raíz basada en la descripción del problema"
            >
                {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lightbulb className="w-3 h-3" />}
                {isAnalyzing ? 'Analizando...' : '✨ Sugerir Análisis IA'}
            </button>
            
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Mecánica (¿Cómo sucede?)</label>
              <textarea name="howHappened" rows="2" value={formData.howHappened} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Explicación técnica..."></textarea>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Causa Raíz (5 Por qué)</label>
              <textarea name="rootCause" rows="2" value={formData.rootCause} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Origen real del fallo..."></textarea>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Justificación</label>
              <textarea name="justification" rows="2" value={formData.justification} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Pruebas realizadas..."></textarea>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="text-lg font-semibold border-b pb-2 flex items-center gap-2 text-slate-700">
              <Check className="w-5 h-5 text-green-600" /> 4. Acción (Contención o Solución)
            </h2>
            
            <div className="flex gap-4 mb-4">
              <label className={`flex-1 p-3 rounded-lg border-2 cursor-pointer text-center transition-all ${formData.actionType === 'contencion' ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold' : 'border-slate-200'}`}>
                <input type="radio" name="actionType" value="contencion" checked={formData.actionType === 'contencion'} onChange={handleChange} className="hidden" />
                Contención
              </label>
              <label className={`flex-1 p-3 rounded-lg border-2 cursor-pointer text-center transition-all ${formData.actionType === 'solucion' ? 'border-green-500 bg-green-50 text-green-700 font-bold' : 'border-slate-200'}`}>
                <input type="radio" name="actionType" value="solucion" checked={formData.actionType === 'solucion'} onChange={handleChange} className="hidden" />
                Solución Definitiva
              </label>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">¿Qué se hizo?</label>
              <textarea name="actionDone" rows="2" value={formData.actionDone} onChange={handleChange} className="w-full p-2 text-sm border rounded" placeholder="Acción tomada..."></textarea>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Responsable</label>
                <input type="text" name="who" value={formData.who} onChange={handleChange} className="w-full p-2 text-sm border rounded" />
              </div>
               <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Recursos</label>
                <input type="text" name="resources" value={formData.resources} onChange={handleChange} className="w-full p-2 text-sm border rounded" />
              </div>
            </div>

            {formData.actionType === 'contencion' ? (
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase text-orange-600">Próximos Pasos (Obligatorio para Contención)</label>
                <textarea name="nextSteps" rows="2" value={formData.nextSteps} onChange={handleChange} className="w-full p-2 text-sm border rounded border-orange-200 bg-orange-50"></textarea>
              </div>
            ) : (
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase text-green-600">Mejora de Proceso (Obligatorio para Solución)</label>
                <textarea name="improvement" rows="2" value={formData.improvement} onChange={handleChange} className="w-full p-2 text-sm border rounded border-green-200 bg-green-50"></textarea>
              </div>
            )}
          </div>
          
          <div className="flex gap-3 flex-col sm:flex-row">
            <button 
                onClick={polishTextWithGemini}
                disabled={isPolishing || isAnalyzing || isGeneratingReport}
                className="flex-1 py-3 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-lg font-bold flex items-center justify-center gap-2 shadow-sm transition-all"
            >
                {isPolishing ? 'Puliendo...' : 'Mejorar Redacción (Inputs)'}
                {!isPolishing && <Wand2 className="w-4 h-4" />}
            </button>

            <button 
                onClick={generateNarrativeReport}
                disabled={isPolishing || isAnalyzing || isGeneratingReport}
                className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 shadow-lg transition-all transform active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
            >
                {isGeneratingReport ? 'Generando Reporte Conciso...' : 'Generar Informe Narrativo'}
                {!isGeneratingReport && <FileEdit className="w-5 h-5" />}
            </button>
          </div>

        </div>

        {/* COLUMNA DERECHA: PREVIEW */}
        <div className="lg:sticky lg:top-8 h-fit space-y-6">
          <div className="bg-slate-800 text-white p-4 rounded-t-xl flex items-center justify-between">
             <h2 className="font-bold flex items-center gap-2">
               <Send className="w-4 h-4" /> Vista Previa del Correo
             </h2>
             <div className="flex gap-2">
                {aiReportText && (
                    <button 
                        onClick={() => setShowAiReport(!showAiReport)}
                        className="text-xs bg-slate-600 hover:bg-slate-500 px-2 py-1 rounded border border-slate-500 transition-colors"
                    >
                        {showAiReport ? 'Ver Plantilla Original' : 'Ver Reporte IA'}
                    </button>
                )}
                <span className="text-xs bg-slate-700 px-2 py-1 rounded">Listo para enviar</span>
             </div>
          </div>
          
          {/* Preview del Asunto */}
          <div className="bg-white border-x border-b border-slate-200 p-4 shadow-sm -mt-6">
            <div className="text-xs text-slate-500 uppercase font-bold mb-1">Asunto:</div>
            <div className="font-mono text-sm bg-slate-100 p-3 rounded border border-slate-300 break-words">
              {generatedSubject}
            </div>
            <button 
              onClick={() => copyToClipboard(generatedSubject, 'subject')}
              className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              {copiedSubject ? <Check className="w-3 h-3" /> : <Clipboard className="w-3 h-3" />}
              {copiedSubject ? '¡Copiado!' : 'Copiar Asunto'}
            </button>
          </div>

          {/* Preview del Cuerpo */}
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden relative">
             {/* Indicador de modo */}
             {showAiReport && (
                 <div className="bg-violet-100 text-violet-800 text-xs font-bold px-4 py-2 text-center border-b border-violet-200 flex items-center justify-center gap-2">
                     <Wand2 className="w-3 h-3" /> Reporte Narrativo Generado por IA
                 </div>
             )}

             <div className="p-6 min-h-[500px] whitespace-pre-wrap text-sm leading-relaxed text-slate-800 font-sans">
               {showAiReport ? aiReportText : generatedBody}
             </div>
             
             <div className="absolute top-12 right-4 flex gap-2">
                <button
                  onClick={() => copyToClipboard(showAiReport ? aiReportText : generatedBody, 'body')}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-bold transition-all"
                >
                  {copiedBody ? <Check className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />}
                  {copiedBody ? 'Copiado' : 'Copiar Informe'}
                </button>

                <button
                  onClick={generateEnglishPDF}
                  disabled={isGeneratingPDF}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Traducir al inglés y descargar como PDF"
                >
                  {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {isGeneratingPDF ? 'Generando...' : 'Descargar PDF'}
                </button>
             </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg text-xs text-blue-800">
            <strong>Nota:</strong> {showAiReport 
                ? 'Este reporte ha sido redactado automáticamente por IA eliminando las preguntas. Verifique los datos antes de enviar.' 
                : 'Esta es la vista de plantilla estándar. Use "Generar Informe Narrativo" para crear una versión en párrafos continuos.'}
          </div>
        </div>

      </div>
    </div>
  );
};

export default ReportGenerator;