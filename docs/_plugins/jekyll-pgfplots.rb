# frozen_string_literal: true

module Jekyll
  class PgfplotsTag < Liquid::Block
    def initialize(tag_name, markup, tokens)
      @file_name = markup.strip.gsub(/\s+/, '_')
      super
    end

    def render(context)
      contents = header + super + footer
      is_draft = context['page']['draft']
      page_path = File.basename(context['page']['url'], '.*')
      tmp_dir = File.join(Dir.pwd, 'pgf_tmp', page_path)
      tex_path = File.join(tmp_dir, "#{@file_name}.tex")
      pdf_path = File.join(tmp_dir, "#{@file_name}.pdf")
      FileUtils.mkdir_p(tmp_dir)

      dest_dir =
        if is_draft
          tmp_dir
        else
          File.join(Dir.pwd, 'assets/pgf', page_path)
        end
      dest_path = File.join(dest_dir, "#{@file_name}.svg")
      FileUtils.mkdir_p(dest_dir)

      unless File.exist?(tex_path) && tikz_same?(tex_path, contents) && File.exist?(dest_path)
        File.open(tex_path, 'w') do |file|
          file.write(contents)
        end
        system("pdflatex -output-directory #{tmp_dir} #{tex_path}")
        system("pdf2svg #{pdf_path} #{dest_path}")
      end

      web_dest_path =
        if is_draft
          File.join('/pgf_tmp', page_path, "#{@file_name}.svg")
        else
          File.join('/assets/pgf', page_path, "#{@file_name}.svg")
        end
      "<embed src=\"#{web_dest_path}\" type=\"image/svg+xml\" />"
    end

    def header
      @header ||= <<~'TEX'
        \documentclass[tikz,border=5mm]{standalone}
        \usepackage{pgfplots}
        \pgfplotsset{compat=1.18}
        \begin{document}
        \usetikzlibrary{
          angles,
          arrows,
          arrows.meta,
          calc,
          decorations.pathreplacing,
          decorations.text,
          math,
          matrix,
          positioning,
          quotes,
          shapes,
        }
        \pgfmathsetseed{27}
        \begin{tikzpicture}
      TEX
    end

    def footer
      @footer = <<~'TEX'

        \end{tikzpicture}
        \end{document}
      TEX
    end

    def tikz_same?(file_name, contents)
      File.open(file_name, 'r') do |file|
        file.read == contents
      end
    end
  end
end

Liquid::Template.register_tag('pgf', Jekyll::PgfplotsTag)
