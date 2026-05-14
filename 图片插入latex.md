# 图片插入 LaTeX 代码

使用前请在论文导言区加入：

```latex
\usepackage{graphicx}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.92\textwidth]{数据流图1.png}
  \caption{系统顶层数据流图}
  \label{fig:dfd-1}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.82\textwidth]{数据流图2.png}
  \caption{用户查询模块数据流图}
  \label{fig:dfd-2}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.88\textwidth]{数据流图3.png}
  \caption{数据检索与处理模块数据流图}
  \label{fig:dfd-3}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.84\textwidth]{数据流图4.png}
  \caption{查询响应生成模块数据流图}
  \label{fig:dfd-4}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.84\textwidth]{数据流图5.png}
  \caption{结果展示模块数据流图}
  \label{fig:dfd-5}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.88\textwidth]{数据流图6.png}
  \caption{系统辅助数据流图}
  \label{fig:dfd-6}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.76\textwidth]{ER图1.png}
  \caption{系统核心实体关系图}
  \label{fig:er-1}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.78\textwidth]{ER图2.png}
  \caption{业务数据实体关系图}
  \label{fig:er-2}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.78\textwidth]{ER图3.png}
  \caption{交易记录实体关系图}
  \label{fig:er-3}
\end{figure}
```

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.76\textwidth]{ER图4.png}
  \caption{系统补充实体关系图}
  \label{fig:er-4}
\end{figure}
```
