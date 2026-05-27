// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDiplomaNFT {
    function mintDiploma(address to, string memory tokenURI) external;
}

contract KahootManager {
    IDiplomaNFT public diplomaContract;
    uint256 public nextGameId;

    struct Game {
        address professor;
        uint256 passingScore;
        uint256 totalQuestions;
        uint256 currentQuestionId;
        string metadataURI;      // <--- NUEVO: Link de IPFS con los textos de las preguntas
        string diplomaTokenURI;  // <--- NUEVO: Link de IPFS con la imagen/meta del NFT de este Kahoot
        uint8[] correctAnswers;  // <--- NUEVO: Array con las opciones correctas de cada pregunta
        bool isFinished;
    }

    struct Question {
        bool commitPhaseOpen;
        bool revealPhaseOpen;
        // Ya no necesitamos guardar correctOption acá, vive en el struct Game
    }

    mapping(uint256 => Game) public games;
    mapping(uint256 => mapping(uint256 => Question)) public questions;
    mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) public commits;
    mapping(uint256 => mapping(address => uint256)) public scores;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event GameCreated(uint256 indexed gameId, address indexed professor, uint256 passingScore, uint256 totalQuestions);
    event QuestionOpened(uint256 indexed gameId, uint256 indexed questionId);
    event RevealPhaseStarted(uint256 indexed gameId, uint256 indexed questionId);
    event DiplomaClaimed(uint256 indexed gameId, address indexed student);

    constructor(address _diplomaAddress) {
        require(_diplomaAddress != address(0), "Address invalida");
        diplomaContract = IDiplomaNFT(_diplomaAddress);
    }

    modifier onlyProfessor(uint256 _gameId) {
        require(games[_gameId].professor == msg.sender, "Solo el profe puede ejecutar esto");
        _;
    }

    // 1. El profesor crea el Kahoot configurando TODO al inicio
    function createGame(
        uint256 _passingScore,
        uint256 _totalQuestions,
        string memory _metadataURI,
        string memory _diplomaTokenURI,
        uint8[] memory _correctAnswers
    ) external returns (uint256) {
        require(_correctAnswers.length == _totalQuestions, "La cantidad de respuestas no coincide con las preguntas");
        require(_passingScore <= _totalQuestions, "El puntaje de aprobacion no puede superar al total");

        uint256 gameId = nextGameId++;
        
        games[gameId] = Game({
            professor: msg.sender,
            passingScore: _passingScore,
            totalQuestions: _totalQuestions,
            currentQuestionId: 0,
            metadataURI: _metadataURI,
            diplomaTokenURI: _diplomaTokenURI,
            correctAnswers: _correctAnswers,
            isFinished: false
        });

        emit GameCreated(gameId, msg.sender, _passingScore, _totalQuestions);
        return gameId;
    }

    // 2. El profe abre la siguiente pregunta (Indexamos desde pregunta 0 para que coincida con el array)
    function startNextQuestion(uint256 _gameId) external onlyProfessor(_gameId) {
        Game storage game = games[_gameId];
        require(!game.isFinished, "El juego termino");
        
        uint256 currentQ = game.currentQuestionId;
        if (currentQ > 0) {
            // Si no es la primera pregunta, nos aseguramos que la anterior ya haya cerrado todo
            require(!questions[_gameId][currentQ - 1].commitPhaseOpen && !questions[_gameId][currentQ - 1].revealPhaseOpen, "Hay una pregunta activa");
        }
        require(currentQ < game.totalQuestions, "No hay mas preguntas en este Kahoot");
        
        questions[_gameId][currentQ].commitPhaseOpen = true;
        emit QuestionOpened(_gameId, currentQ);
    }

    // 3. Los alumnos envian su hash (Igual que antes)
    function commitAnswer(uint256 _gameId, bytes32 _commitHash) external {
        uint256 currentQ = games[_gameId].currentQuestionId;
        require(questions[_gameId][currentQ].commitPhaseOpen, "Fase de commit cerrada");
        require(commits[_gameId][currentQ][msg.sender] == bytes32(0), "Ya respondiste");

        commits[_gameId][currentQ][msg.sender] = _commitHash;
    }

    // 4. El profe cierra la fase de respuestas y abre la de revelacion
    // NOTA: Ya no tiene que pasar la respuesta correcta por parametro, el contrato ya la sabe.
    function closeQuestionAndStartReveal(uint256 _gameId) external onlyProfessor(_gameId) {
        uint256 currentQ = games[_gameId].currentQuestionId;
        require(questions[_gameId][currentQ].commitPhaseOpen, "La pregunta no esta en fase de commit");

        questions[_gameId][currentQ].commitPhaseOpen = false;
        questions[_gameId][currentQ].revealPhaseOpen = true;

        emit RevealPhaseStarted(_gameId, currentQ);
    }

    // 5. Los alumnos revelan su respuesta
    function revealAnswer(uint256 _gameId, uint256 _questionId, uint8 _option, string memory _salt) external {
        require(questions[_gameId][_questionId].revealPhaseOpen, "Fase de reveal cerrada");
        
        bytes32 storedCommit = commits[_gameId][_questionId][msg.sender];
        require(storedCommit != bytes32(0), "No hiciste commit en esta pregunta");
        
        bytes32 generatedHash = keccak256(abi.encodePacked(_option, _salt));
        require(generatedHash == storedCommit, "El hash no coincide");

        commits[_gameId][_questionId][msg.sender] = bytes32(0);

        // MODIFICACION: Validamos contra el array pre-configurado en el juego
        if (_option == games[_gameId].correctAnswers[_questionId]) {
            scores[_gameId][msg.sender] += 1;
        }
    }

    // 6. El profesor avanza el indice para pasar a la siguiente pregunta cuando termina la ronda de reveals
    function advanceToNextQuestion(uint256 _gameId) external onlyProfessor(_gameId) {
        uint256 currentQ = games[_gameId].currentQuestionId;
        require(questions[_gameId][currentQ].revealPhaseOpen, "Primero tenes que abrir los reveals");
        
        questions[_gameId][currentQ].revealPhaseOpen = false; // Cerramos los reveals definitivamente
        
        games[_gameId].currentQuestionId += 1;
        
        if (games[_gameId].currentQuestionId == games[_gameId].totalQuestions) {
            games[_gameId].isFinished = true;
        }
    }

    // 7. El alumno reclama su Diploma si alcanza el puntaje
    // NOTA: Ya no le pedimos el string _tokenURI al alumno. Usamos el del juego por seguridad.
    function claimDiploma(uint256 _gameId) external {
        require(!hasClaimed[_gameId][msg.sender], "Ya reclamaste tu diploma");
        require(scores[_gameId][msg.sender] >= games[_gameId].passingScore, "No alcanzas el puntaje minimo");

        hasClaimed[_gameId][msg.sender] = true;
        
        // El NFT se mina con los metadatos oficiales del juego cargados por el profesor
        diplomaContract.mintDiploma(msg.sender, games[_gameId].diplomaTokenURI);
        
        emit DiplomaClaimed(_gameId, msg.sender);
    }
}